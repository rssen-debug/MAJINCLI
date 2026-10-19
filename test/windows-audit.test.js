import test from 'node:test';
import assert from 'node:assert/strict';
import { selectShell, shellTools } from '../src/core/tools/shell.js';
import { explainError, ProviderError } from '../src/core/provider/chat.js';
import { bus } from '../src/core/log.js';

test('global events retain their namespace and sequence when payload carries its own type/id', () => {
  let received;
  const off = bus.on('agent.answer', ev => { received = ev; });
  try {
    const next = bus.seq + 1;
    bus.emit('agent.answer', { type: 'answer', id: -1, text: 'one answer' });
    assert.equal(received?.type, 'agent.answer');
    assert.equal(received.id, next);
  } finally { off(); }
});

test('Windows without pwsh uses built-in PowerShell, then cmd when necessary', () => {
  const seen = [];
  const selected = selectShell({ windows: true, probe: (cmd) => { seen.push(cmd); return cmd === 'powershell.exe'; } });
  assert.deepEqual(seen, ['pwsh.exe', 'powershell.exe']);
  assert.equal(selected.cmd, 'powershell.exe');
  assert.equal(selectShell({ windows: true, probe: cmd => cmd === 'cmd.exe' }).cmd, 'cmd.exe');
  assert.throws(() => selectShell({ windows: true, probe: () => false }), /No supported system shell/);
});

test('shell.run executes in default workspace when caller supplies no cwd or config workspace', async () => {
  const tool = shellTools.find(t => t.name === 'shell.run');
  const result = await tool.run({ command: 'node -e "console.log(42)"' }, { cfg: { get: () => undefined } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.meta.exitCode, 0);
  assert.match(result.result, /42/);
});

test('OpenCode free-tier restriction explains access policy without blaming a valid key', () => {
  const info = explainError(new ProviderError("403: OpenCode's free tier can only be used from within OpenCode.", { status: 403 }), { providerName: 'opencode' });
  assert.equal(info.kind, 'access');
  assert.equal(info.retryable, false);
  assert.equal(info.needsKey, false);
  assert.match(info.human, /OpenCode app/);
  assert.doesNotMatch(info.human, /wrong|deleted|top.*up/i);
  assert.equal(explainError(new ProviderError('Forbidden', { status: 403 })).kind, 'access');
  assert.equal(explainError(new ProviderError('invalid API key', { status: 401 })).kind, 'auth');
});
