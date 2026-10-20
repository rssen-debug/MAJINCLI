/**
 * MAJIN provider acceptance against OpenCode Zen FREE endpoints only.
 * No paid fallback, no Ollama, no key output, no persistent user state.
 */
import assert from 'node:assert/strict';
import { openaiOnce } from '../../src/core/provider/openai.js';

const key = process.env.OPENCODE_API_KEY;
if (!key) throw new Error('OPENCODE_API_KEY secret not configured');
const root = 'https://opencode.ai/zen/v1';
const allowed = ['mimo-v2.6-flash-free', 'longcat-2.5-preview-free', 'space-bunny-free', 'nemotron-3.5-lightning-free'];
const report = { provider: 'OpenCode Zen', billing: 'free-only', passed: [], failed: [], blocked: [], model: null };
function record(kind, step, reason) {
  report[kind].push({ step, ...(reason ? { reason: String(reason).replaceAll(key, '[REDACTED]').slice(0, 300) } : {}) });
  console.log(kind.toUpperCase() + ': ' + step + (reason ? ' (' + String(reason).replaceAll(key, '[REDACTED]').slice(0, 180) + ')' : ''));
}
try {
  const catalog = await fetch(root + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(12000) });
  if (!catalog.ok) throw new Error('model catalog HTTP ' + catalog.status);
  const json = await catalog.json();
  const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : [];
  const names = list.map(x => typeof x === 'string' ? x : x.id || x.name);
  const chosen = allowed.find(x => names.includes(x));
  if (!chosen) {
    record('blocked', 'free model discovery', 'No approved free model in live catalog; no inference request sent');
    process.exitCode = 2;
  } else {
    assert.ok(chosen.endsWith('-free'));
    report.model = chosen;
    record('passed', 'catalog lists allowlisted free model ' + chosen);
    const route = { apiKey: key, baseUrl: root, endpoint: root + '/chat/completions', model: chosen };
    const result = await openaiOnce({ route, messages: [{ role: 'user', content: 'Reply exactly MAJIN_OK' }], maxTokens: 40, temperature: 0 });
    assert.ok(result.text && result.text.trim().length > 0, 'empty model response');
    record('passed', 'MAJIN openaiOnce produced real free-model completion');
    const tools = [{ name: 'qa_echo', description: 'Return the provided text', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }];
    const answer = await openaiOnce({ route, messages: [{ role: 'user', content: 'Use the qa_echo tool with text set to MAJIN_TOOL_OK. Do not answer in plain text.' }], tools, maxTokens: 128, temperature: 0 });
    if (answer.toolCalls.some(x => x.name === 'qa_echo')) record('passed', 'MAJIN tool-call parsing from real free model');
    else { record('failed', 'MAJIN tool-call parsing', 'Model did not call the provided tool'); process.exitCode = 1; }
  }
} catch (e) {
  const msg = String(e?.message || e).replaceAll(key, '[REDACTED]');
  const isBlocked = /FreeTierError|free tier can only be used|HTTP 402|HTTP 403|HTTP 429|401:|403:|402:|429:/.test(msg);
  record(isBlocked ? 'blocked' : 'failed', 'OpenCode free inference', msg);
  process.exitCode = isBlocked ? 2 : 1;
}
console.log('RESULT ' + JSON.stringify(report));
