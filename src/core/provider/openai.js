/**
 * LENT — OpenAI-compatible transport (works with DeepSeek, OpenRouter, Groq,
 * OpenAI, Ollama, LM Studio, vLLM, llama.cpp server, Nous, Together, xAI…).
 * Handles SSE streaming and incremental tool_call assembly.
 */
import { ProviderError } from './chat.js';
import { bus } from '../log.js';

const TIMEOUT_MS = Number(process.env.LENT_LLM_TIMEOUT || 180000);

function headersFor(route) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${route.apiKey}`,
    ...(route.extraHeaders || {}),
  };
}

export function buildMessages(route, messages) {
  const out = [];
  for (const m of messages) {
    if (!m) continue;
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: m.content ? String(m.content) : null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}) },
        })),
      });
      continue;
    }
    if (Array.isArray(m.content)) {
      const parts = m.content.filter((p) => p && (p.type === 'image_url' || p.type === 'text'));
      out.push({ role: m.role, content: parts.length ? parts : contentToText(m.content) });
      continue;
    }
    out.push({ role: m.role, content: contentToText(m.content) });
  }
  return out;
}

function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part.type === 'text') return part.text;
        if (part.type === 'image_url') return `[image ${String(part.image_url?.url || '').slice(0, 24)}…]`;
        return part.text || '';
      })
      .join('\n');
  }
  return String(content);
}

function body(route, { messages, tools, maxTokens, temperature, stream, toolChoice, extra }) {
  const b = {
    model: route.model,
    messages: buildMessages(route, messages),
    stream: Boolean(stream),
    max_tokens: maxTokens,
    temperature,
  };
  if (b.stream) b.stream_options = { include_usage: true };
  if (tools?.length) {
    b.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    b.tool_choice = toolChoice ?? 'auto';
  }
  return { ...b, ...(extra || {}) };
}

async function send(route, payload, { signal } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('timeout')), TIMEOUT_MS);
  to.unref?.();
  const onAbort = () => ctrl.abort(new Error('aborted'));
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    const res = await fetch(route.endpoint || route.baseUrl, { method: 'POST', headers: headersFor(route), body: JSON.stringify(payload), signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(to);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

async function fail(res) {
  const text = await res.text().catch(() => '');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* html error page */
  }
  const msg = parsed?.error?.message || parsed?.message || text.slice(0, 400) || `HTTP ${res.status}`;
  throw new ProviderError(`${res.status}: ${msg}`, {
    status: res.status,
    code: parsed?.error?.code || `http_${res.status}`,
    retryable: res.status === 429 || res.status >= 500,
    hint: res.status === 401 ? 'Fel eller borttagen API-nyckel.' : res.status === 429 ? 'Ratelimit — LENT backoffar och försöker igen.' : res.status === 404 ? 'baseUrl eller modellnamn fel.' : null,
  });
}

export async function openaiOnce(o) {
  const { route, tools = [], messages, signal, maxTokens, temperature, onEvent } = o;
  const res = await send(route, body(route, { messages, tools, maxTokens, temperature, stream: false, extra: o.extra }), { signal });
  if (!res.ok) await fail(res);
  const json = await res.json();
  const choice = json.choices?.[0];
  const msg = choice?.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => ({
    id: tc.id || `call_${Math.random().toString(36).slice(2, 8)}`,
    name: tc.function?.name,
    argsJson: tc.function?.arguments || '{}',
  }));
  onEvent?.({ type: 'delta', text: msg.content || '' });
  return {
    text: msg.content || '',
    reasoning: msg.reasoning_content || msg.reasoning || null,
    toolCalls,
    usage: usage(json.usage, msg.content, toolCalls),
    stopReason: choice?.finish_reason || 'stop',
    raw: { id: json.id, model: json.model },
  };
}

export async function openaiStream(o) {
  const { route, tools = [], messages, signal, maxTokens, temperature, onEvent } = o;
  const res = await send(route, body(route, { messages, tools, maxTokens, temperature, stream: true, extra: o.extra }), { signal });
  if (!res.ok) await fail(res);
  let text = '';
  let reasoning = '';
  const calls = new Map();
  let finish = 'stop';
  let usageObj = null;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev.usage) usageObj = ev.usage;
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      if (d.content) {
        text += d.content;
        onEvent?.({ type: 'delta', text: d.content });
      }
      if (d.reasoning_content || d.reasoning) {
        const r = d.reasoning_content || d.reasoning;
        reasoning += r;
        onEvent?.({ type: 'thinking', text: r });
      }
      for (const tc of d.tool_calls || []) {
        const key = tc.index ?? 0;
        const cur = calls.get(key) || { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(key, cur);
        if (tc.function?.name && !cur.notified) {
          cur.notified = true;
          onEvent?.({ type: 'tool', name: cur.name });
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  if (text.length > 6000) bus.warn('stream.truncated', { chars: text.length });
  const toolCalls = [...calls.values()].filter((c) => c.name).map((c) => ({ id: c.id || `call_${Math.random().toString(36).slice(2, 8)}`, name: c.name, argsJson: c.args || '{}' }));
  return {
    text,
    reasoning: reasoning || null,
    toolCalls,
    usage: usageObj || usage(null, text, toolCalls),
    stopReason: finish,
    raw: {},
  };
}

function usage(u, text, toolCalls) {
  if (u) return { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, cached: u.prompt_tokens_details?.cached_tokens || 0, reported: true };
  const approx = Math.ceil((String(text).length + JSON.stringify(toolCalls || []).length) / 4);
  return { input: 0, output: approx, reported: false };
}
