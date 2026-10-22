/**
 * MAJIN V4 — server-side voice.
 *
 * Reuses the V2 voice lane verbatim (`src/v2/voice/speak.js`, `listen.js`,
 * `tts.js`, `stt.js`): the same consent path, the same kernel error classes and
 * the same "the produced file is the proof" rule. V4 adds only two things:
 *
 *   - a provider choice that depends on what is actually available
 *     (`buffer` is deterministic offline; `edge-tts` needs network to Microsoft)
 *   - an HTTP surface that streams the produced audio back and reports the
 *     verification result instead of claiming success
 *
 * The browser's own SpeechSynthesis stays the default in the UI. This exists so
 * that a phone without a Swedish voice — or a future server-side pipeline — has
 * a proven path, not so that MAJIN can advertise a voice it has not measured.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { speak } from '../v2/voice/speak.js';
import { listen } from '../v2/voice/listen.js';
import { EdgeTtsProvider, BufferTtsProvider, CommandTtsProvider } from '../v2/voice/tts.js';
import { BufferSttProvider, CommandSttProvider } from '../v2/voice/stt.js';

export const VOICE_MODES = Object.freeze(['auto', 'buffer', 'edge-tts']);

/**
 * Pick a provider. `auto` prefers the real engine and falls back to the offline
 * one; it never pretends the offline one is speech synthesis of a real voice.
 */
export function makeTtsProvider({ mode = 'auto', voice = null } = {}) {
  if (mode === 'edge-tts') return new EdgeTtsProvider(voice ? { defaultVoice: voice } : {});
  if (mode === 'buffer') return new BufferTtsProvider();
  return new EdgeTtsProvider(voice ? { defaultVoice: voice } : {});
}

export function makeSttProvider({ command = null } = {}) {
  return command ? new CommandSttProvider({ commandTemplate: command }) : new BufferSttProvider({});
}

/**
 * Synthesize into a private temp dir and return the bytes plus the V2 verdict.
 * The caller decides what to do with a failed verification; nothing here turns
 * a failure into a success.
 */
export async function synthesize({ text, mode = 'auto', voice = null, approvals, dir }) {
  const provider = makeTtsProvider({ mode, voice });
  const target = path.join(dir || fs.mkdtempSync(path.join(os.tmpdir(), 'majin-tts-')), `speech-${Date.now()}.${provider.name === 'edge-tts' ? 'mp3' : 'wav'}`);
  const started = Date.now();
  let result;
  try {
    result = await speak(text, { provider, approvals, outPath: target });
  } catch (err) {
    return {
      ok: false,
      provider: provider.name,
      errorClass: err?.cls || 'MODEL_FAILURE',
      message: String(err?.message || err),
      elapsedMs: Date.now() - started,
    };
  }
  if (result.ok === false && result.decision === 'waiting') {
    return { ok: false, provider: provider.name, pendingConsent: true, scope: result.pendingScope, message: result.reason };
  }
  const audioPath = result.audioPath || target;
  let bytes = 0;
  try {
    bytes = fs.statSync(audioPath).size;
  } catch {
    bytes = 0;
  }
  return {
    ok: Boolean(result.ok) && bytes > 0,
    provider: provider.name,
    format: provider.name === 'edge-tts' ? 'mp3' : 'wav',
    bytes,
    verified: result.verified === true,
    audioPath,
    elapsedMs: Date.now() - started,
    // A buffer provider produces a valid but silent WAV: it proves the pipeline,
    // not the voice. Say which one happened.
    synthetic: provider.name === 'buffer',
  };
}

export async function transcribe({ audioPath, command = null }) {
  const provider = makeSttProvider({ command });
  const started = Date.now();
  try {
    const result = await listen(audioPath, { provider });
    return {
      ok: Boolean(result.ok),
      verdict: result.verdict || 'inconclusive',
      transcript: result.transcript || '',
      provider: provider.name,
      elapsedMs: Date.now() - started,
      synthetic: provider.name === 'buffer',
    };
  } catch (err) {
    return {
      ok: false,
      verdict: 'failed',
      transcript: '',
      errorClass: err?.cls || 'MODEL_FAILURE',
      message: String(err?.message || err),
      provider: provider.name,
      elapsedMs: Date.now() - started,
    };
  }
}

export { CommandTtsProvider, BufferTtsProvider };
