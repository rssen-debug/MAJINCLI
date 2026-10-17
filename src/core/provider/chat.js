/**
 * MAJIN — provider transport.
 * One request path, three dialects (OpenAI-compatible, Anthropic, mock).
 * Streaming in, tool calls out, retries with backoff, token+cost accounting.
 */
import { bus } from '../log.js';
import { openaiStream, openaiOnce } from './openai.js';
import { anthropicStream, anthropicOnce } from './anthropic.js';
import { mockComplete } from './mock.js';

export class ProviderError extends Error {
  constructor(msg, { status = 0, code = 'provider_error', hint = null, retryable = false } = {}) {
    super(msg);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.retryable = retryable;
  }
}

/**
 * @param {object} o
 * @param {object} o.route      cfg.resolveModel() output
 * @param {Array}  o.messages   [{role, content|tool_calls}]
 * @param {Array}  [o.tools]    [{name, description, parameters}]
 * @param {Function} [o.onEvent] (ev)=>void  {type:'delta',text} | {type:'tool',name}
 */
export async function complete(o) {
  const { route, messages, tools = [], onEvent, signal, maxTokens, temperature, job } = o;
  const max = maxTokens ?? route.maxTokens ?? 4096;
  const temp = temperature ?? route.temperature ?? 0.2;
  const retries = o.retries ?? 2;
  let attempt = 0;
  const started = Date.now();
  for (;;) {
    attempt += 1;
    try {
      const res = await dispatch({ ...o, maxTokens: max, temperature: temp });
      res.elapsedMs = Date.now() - started;
      res.attempts = attempt;
      res.job = job;
      if (res.usage) res.usage.costUsd = costOf(route, res.usage);
      return res;
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.retryable : /network|socket|timeout|ETIMEDOUT|ECONN|fetch failed|429|5\d\d/i.test(String(err?.message));
      if (!retryable || attempt > retries || signal?.aborted) throw err;
      const backoff = Math.min(15000, 800 * 2 ** (attempt - 1)) + Math.random() * 400;
      bus.warn('provider.retry', { job, provider: route.providerName, attempt, backoff: Math.round(backoff), error: err.message });
      await sleep(backoff, signal);
      if (signal?.aborted) throw err;
    }
  }
}

async function dispatch(o) {
  const { route } = o;
  if (route.kind === 'mock') return mockComplete(o);
  if (!route.apiKey) {
    throw new ProviderError(`Ingen API-nyckel för "${route.providerName}"`, {
      code: 'no_key',
      hint: 'Lägg till nyckel i Settings → Providers, eller säg till mig: "sätt nyckeln för deepseek: sk-…"',
    });
  }
  if (route.kind === 'anthropic') return o.stream ? anthropicStream(o) : anthropicOnce(o);
  return o.stream ? openaiStream(o) : openaiOnce(o);
}

export function costOf(route, usage) {
  const p = route.pricing;
  if (!p) return 0;
  return ((usage.input || 0) / 1e6) * (p.in || 0) + ((usage.output || 0) / 1e6) * (p.out || 0);
}

export function sleep(ms, signal) {
  return new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener?.('abort', () => (clearTimeout(t), res()), { once: true });
  });
}

export { openaiStream, openaiOnce };
