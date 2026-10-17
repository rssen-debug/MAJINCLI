/**
 * LENT — Anthropic transport (messages API) with the same internal contract as
 * the OpenAI path, so tools/MOA/agent never know which dialect they are on.
 */
import { ProviderError } from './chat.js';

const TIMEOUT_MS = Number(process.env.LENT_LLM_TIMEOUT || 180000);

function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: textOf(m.content) }] });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content = [];
      if (m.content) content.push({ type: 'text', text: textOf(m.content) });
      for (const tc of m.tool_calls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parseArgs(tc) });
      out.push({ role: 'assistant', content });
      continue;
    }
    out.push({ role: m.role, content: textOf(m.content) });
  }
  return { system, messages: out.length ? out : [{ role: 'user', content: ' ' }] };
}

function parseArgs(tc) {
  if (tc.args && typeof tc.args === 'object') return tc.args;
  try {
    return JSON.parse(tc.argsJson || '{}');
  } catch {
    return {};
  }
}

function textOf(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n');
  return String(c);
}

async function send(route, payload, { signal }) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(new Error('timeout')), TIMEOUT_MS);
  to.unref?.();
  const onAbort = () => ctrl.abort(new Error('aborted'));
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    return await fetch(route.endpoint || `${String(route.baseUrl).replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': route.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(to);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

async function fail(res) {
  const t = await res.text().catch(() => '');
  let msg = t.slice(0, 400);
  try {
    msg = JSON.parse(t)?.error?.message || msg;
  } catch {
    /* keep raw */
  }
  throw new ProviderError(`${res.status}: ${msg}`, { status: res.status, retryable: res.status === 429 || res.status >= 500, hint: res.status === 401 ? 'Fel Anthropic-nyckel.' : null });
}

function payload(o, stream) {
  const { system, messages } = toAnthropic(o.messages || []);
  const p = {
    model: o.route.model,
    max_tokens: o.maxTokens ?? 4096,
    temperature: o.temperature ?? 0.2,
    messages,
    stream: Boolean(stream),
  };
  if (system) p.system = system;
  if (o.tools?.length) p.tools = o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return p;
}

export async function anthropicOnce(o) {
  const res = await send(o.route, payload(o, false), { signal: o.signal });
  if (!res.ok) await fail(res);
  const j = await res.json();
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const toolCalls = (j.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, argsJson: JSON.stringify(b.input || {}) }));
  o.onEvent?.({ type: 'delta', text });
  return {
    text,
    reasoning: null,
    toolCalls,
    usage: { input: j.usage?.input_tokens || 0, output: j.usage?.output_tokens || 0, reported: true },
    stopReason: j.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    raw: { id: j.id },
  };
}

export async function anthropicStream(o) {
  const res = await send(o.route, payload(o, true), { signal: o.signal });
  if (!res.ok) await fail(res);
  let text = '';
  let usage = { input: 0, output: 0, reported: true };
  const blocks = new Map();
  let stop = 'stop';
  let buf = '';
  const dec = new TextDecoder();
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let ev;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === 'content_block_start') blocks.set(ev.index, { type: ev.content_block?.type, name: ev.content_block?.name, id: ev.content_block?.id, json: '' });
      if (ev.type === 'content_block_delta') {
        const b = blocks.get(ev.index);
        if (ev.delta?.type === 'text_delta') {
          text += ev.delta.text;
          o.onEvent?.({ type: 'delta', text: ev.delta.text });
        } else if (ev.delta?.type === 'input_json_delta' && b) b.json += ev.delta.partial_json;
      }
      if (ev.type === 'message_delta') {
        usage.input = ev.usage?.input_tokens ?? usage.input;
        usage.output = ev.usage?.output_tokens ?? usage.output;
        if (ev.delta?.stop_reason === 'tool_use') stop = 'tool_calls';
      }
    }
  }
  const toolCalls = [...blocks.values()]
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, argsJson: b.json || '{}' }));
  return { text, reasoning: null, toolCalls, usage, stopReason: stop, raw: {} };
}
