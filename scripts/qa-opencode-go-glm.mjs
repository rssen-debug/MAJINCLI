import { load } from '../src/core/config.js';
import { PRESETS } from '../src/core/presets.js';

const cfg = load();
const go = cfg.get('providers.opencode') || {};
const raw = process.env.OPENCODE_API_KEY || process.env.MAJIN_QA_OPENCODE_GO_KEY || go.apiKey || '';
const key = String(raw).trim();
const model = 'glm-5.3-flash';
if (!key || key.startsWith('{env:') || key === 'null') {
  console.error('NOT_TESTED: OpenCode Go credential not configured on this Windows runner. Add key locally to MAJIN provider or runner environment.');
  process.exitCode = 2;
} else {
  const base = String(go.baseUrl || PRESETS.opencode.baseUrl).replace(/\/$/, '');
  if (base !== 'https://opencode.ai/zen/go/v1') {
    console.error('BLOCKED: OpenCode provider URL is not the Go gateway (Zen is forbidden for this test).');
    process.exitCode = 3;
  } else {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let res;
      try {
        res = await fetch(base + '/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: {
            authorization: 'Bearer ' + key,
            'content-type': 'application/json',
            'x-opencode-session': 'majin'
          },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly the word READY.' }], max_tokens: 30, stream: false })
        });
      } finally { clearTimeout(timer); }
      if (!res.ok) {
        console.error('FAIL: OpenCode Go GLM inference HTTP ' + res.status + '. Body withheld to avoid credential disclosure.');
        process.exitCode = 1;
      } else {
        const data = await res.json();
        const answer = data?.choices?.[0]?.message?.content;
        if (typeof answer !== 'string' || !answer.trim()) {
          console.error('FAIL: OpenCode Go GLM returned no usable assistant text.');
          process.exitCode = 1;
        } else {
          console.log('PASS: OpenCode Go GLM authenticated live inference returned assistant text (content redacted).');
        }
      }
    } catch (e) {
      console.error('FAIL: OpenCode Go GLM request failed: ' + (e?.name === 'AbortError' ? 'timeout' : 'network/transport error'));
      process.exitCode = 1;
    }
  }
}
