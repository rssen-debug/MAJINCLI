import test from 'node:test';
import assert from 'node:assert/strict';
import { Config, DEFAULTS, clone } from '../src/core/config.js';
import { openaiOnce, openaiStream } from '../src/core/provider/openai.js';
import { complete } from '../src/core/provider/chat.js';

function goRoute(withKey = true) {
  const data = clone(DEFAULTS);
  data.providers.opencode.apiKey = withKey ? 'fake-go-test-key' : null;
  return new Config(data).resolveModel('opencode/glm-5.3-flash', 'chat');
}

test('OpenCode Go sends a chat request to Go, not Zen, retaining auth and session headers', async () => {
  const route = goRoute();
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({url,opts});
    return new Response(JSON.stringify({
      id:'mock-completion', model:'glm-5.3-flash',
      choices:[{message:{content:'Go mock response'},finish_reason:'stop'}],
      usage:{prompt_tokens:3,completion_tokens:4,total_tokens:7},
    }),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const result = await openaiOnce({
      route, messages:[{role:'user',content:'Ping via Go'}],
      maxTokens:80, temperature:0.2, tools:[],
    });
    assert.equal(result.text, 'Go mock response');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://opencode.ai/zen/go/v1/chat/completions');
    assert.equal(requests[0].opts.headers.authorization, 'Bearer fake-go-test-key');
    assert.equal(requests[0].opts.headers['x-opencode-session'], 'majin');
    const body = JSON.parse(requests[0].opts.body);
    assert.equal(body.model, 'glm-5.3-flash');
    assert.equal(body.messages[0].content, 'Ping via Go');
    assert.equal(body.stream, false);
  } finally { globalThis.fetch = original; }
});

test('OpenCode Go stream assembles cloud tool calls without a network dependency', async () => {
  const route = goRoute();
  const original = globalThis.fetch;
  const events = [];
  let sent;
  globalThis.fetch = async (url, opts) => {
    sent = {url,opts};
    const sse = [
      'data: ' + JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_1',function:{name:'fs.write',arguments:'{"path":"x.txt"'}}]}}]}),
      'data: ' + JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:',"content":"ok"}'}}]}}],finish_reason:'tool_calls'}]}),
      'data: [DONE]',
      '',
    ].join('\\n') + '\\n';
    return new Response(sse,{status:200,headers:{'content-type':'text/event-stream'}});
  };
  try {
    const result = await openaiStream({
      route, messages:[{role:'user',content:'Write x.txt'}],
      tools:[{name:'fs.write',description:'write file',parameters:{type:'object',properties:{path:{type:'string'}}}}],
      maxTokens:80, temperature:0,
      onEvent: e => events.push(e),
    });
    assert.equal(sent.url, 'https://opencode.ai/zen/go/v1/chat/completions');
    assert.equal(sent.opts.headers['x-opencode-session'], 'majin');
    assert.equal(JSON.parse(sent.opts.body).stream, true);
    assert.equal(result.toolCalls?.length, 1);
    assert.equal(result.toolCalls[0].name, 'fs.write');
    assert.deepEqual(JSON.parse(result.toolCalls[0].argsJson), {path:'x.txt',content:'ok'});
    assert.equal(result.stopReason, 'tool_calls');
  } finally { globalThis.fetch = original; }
});

test('OpenCode Go without credentials fails locally and cannot silently call another API', async () => {
  const route = goRoute(false);
  // Ignore any external OPENCODE_API_KEY in CI; this tests the no-key branch.
  route.apiKey = '';
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('unexpected external call'); };
  try {
    await assert.rejects(
      complete({route,messages:[{role:'user',content:'hello'}],tools:[],retries:0}),
      error => error.code === 'no_key',
    );
    assert.equal(called, false);
  } finally { globalThis.fetch = original; }
});
