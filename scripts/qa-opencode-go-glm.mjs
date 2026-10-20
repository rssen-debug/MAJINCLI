import { load } from '../src/core/config.js';
import { PRESETS } from '../src/core/presets.js';

const cfg = load();
const providers = cfg.get('providers') || {};
const goEndpoint = PRESETS.opencode.baseUrl;
const goCandidates = Object.entries(providers).filter(([name, p]) =>
  p && (String(p.baseUrl || '').replace(/\/$/, '') === goEndpoint || name === 'opencode')
);
const selected = goCandidates.find(([, p]) => {
  const k = String(p.apiKey || '').trim();
  return k && !k.startsWith('{env:') && k !== 'null';
});
const go = selected?.[1] || goCandidates[0]?.[1] || {};
const raw = process.env.MAJIN_QA_OPENCODE_GO_KEY || process.env.OPENCODE_API_KEY || selected?.[1]?.apiKey || '';
const key = String(raw).trim();
const model = 'glm-5.3-flash';
if (!key || key.startsWith('{env:') || key === 'null') {
  console.error('NOT_TESTED: no usable Go key in repository secret, runner environment, or saved MAJIN Go providers. Add a rotated key to MAJIN_QA_OPENCODE_GO_KEY.');
  process.exitCode = 2;
} else {
  const base = goEndpoint;
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
