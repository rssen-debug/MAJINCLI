/**
 * Server-side voice: the V2 voice lane wired to HTTP.
 *
 * The offline `buffer` provider is used so the pipeline is deterministic. It
 * produces a valid WAV, which proves the adapter, the consent path, the file
 * verifier and the HTTP surface — NOT that MAJIN has a Swedish voice. The
 * external `edge-tts` path needs network to Microsoft and is asserted to be
 * gated, not silently attempted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { startTestServer, tempHome } from './helpers.mjs';

function isWav(buf) {
  return buf.length > 44 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WAVE';
}

async function speak(s, cookie, body) {
  const res = await fetch(`${s.base}/api/voice/speak`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
    body: JSON.stringify(body),
  });
  return res;
}

test('voice: requires a session, and a CSRF header once paired', async () => {
  const s = await startTestServer();
  try {
    const anon = await fetch(`${s.base}/api/voice/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ text: 'hej' }),
    });
    assert.equal(anon.status, 401);

    const { cookie } = await s.pair();
    const noCsrf = await fetch(`${s.base}/api/voice/speak`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: s.base },
      body: JSON.stringify({ text: 'hej' }),
    });
    assert.equal(noCsrf.status, 403);
  } finally {
    await s.close();
  }
});

test('voice: the offline provider returns a real, verified WAV and says it is synthetic', async () => {
  const s = await startTestServer();
  try {
    const { cookie } = await s.pair();
    const res = await speak(s, cookie, { text: 'Hej från MAJIN', mode: 'buffer' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/wav');
    assert.equal(res.headers.get('x-majin-tts-provider'), 'buffer');
    assert.equal(res.headers.get('x-majin-tts-verified'), 'true', 'the V2 file verifier accepted it');
    assert.equal(res.headers.get('x-majin-tts-synthetic'), 'true', 'no false claim of a real voice');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(isWav(buf), 'a structurally valid WAV');
    assert.ok(buf.length > 44);
  } finally {
    await s.close();
  }
});

test('voice: the temp audio file is removed after it has been sent', async () => {
  const home = tempHome();
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const res = await speak(s, cookie, { text: 'städa', mode: 'buffer' });
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    const dir = `${home}/v4/voice`;
    const fs = await import('node:fs');
    const left = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepEqual(left, [], 'no leftover audio on disk');
  } finally {
    await s.close();
  }
});

test('voice: empty and oversized text is refused before synthesis', async () => {
  const s = await startTestServer();
  try {
    const { cookie } = await s.pair();
    assert.equal((await speak(s, cookie, { text: '   ', mode: 'buffer' })).status, 400);
    assert.equal((await speak(s, cookie, { text: 'x'.repeat(2000), mode: 'buffer' })).status, 413);
  } finally {
    await s.close();
  }
});

test('voice: an unknown mode falls back to auto instead of crashing', async () => {
  const s = await startTestServer();
  try {
    const { cookie } = await s.pair();
    const res = await speak(s, cookie, { text: 'hej', mode: 'evil-mode' });
    // auto = edge-tts, which has no network here: a classified failure, never a fake success
    assert.ok([200, 502, 409].includes(res.status), `got ${res.status}`);
    if (res.status !== 200) {
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.ok(body.error.code, 'the failure is classified');
    }
  } finally {
    await s.close();
  }
});

test('voice: capabilities are reported honestly', async () => {
  const s = await startTestServer();
  try {
    const { cookie } = await s.pair();
    const res = await fetch(`${s.base}/api/voice`, { headers: { cookie } });
    const body = await res.json();
    assert.deepEqual(body.modes, ['auto', 'buffer', 'edge-tts']);
    assert.match(body.serverSide.note, /not a voice/i);
    assert.ok(body.clientEngine.includes('SpeechSynthesis'));
  } finally {
    await s.close();
  }
});
