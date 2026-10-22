/**
 * V2 voice lane: STT adapters (PHASE 6). Same discipline as TTS: consent for
 * external providers, file/input proof chains, kernel-classified failures.
 *
 * Providers:
 *  - 'command': host-whisper CLI (whisper.cpp / faster-whisper) — offline
 *    local execution; preflight-gated like every shell path in V2.
 *  - 'buffer' : deterministic offline wordmap for tests/CI.
 * External cloud STT intentionally not wired yet (consent gate exists but no
 * provider adopted — logged in the dependency matrix).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { preflight } from '../safety/command-preflight.js';
import { ModelError } from '../model/provider.js';

export class CommandSttProvider {
  /** commandTemplate e.g. 'whisper-cli -m model.bin -f {WAV} --output-txt --no-prints' */
  constructor({ commandTemplate, wavDependency = 'ffmpeg or wav input', timeoutMs = 120_000 } = {}) {
    this.name = 'command';
    this.kind = 'local';
    this.commandTemplate = commandTemplate;
    this.wavDependency = wavDependency;
    this.timeoutMs = timeoutMs;
  }

  async transcribe(wavPath) {
    if (!this.commandTemplate) throw new ModelError('DEPENDENCY_MISSING', 'stt command has no template');
    if (!fs.existsSync(wavPath)) throw new ModelError('DEPENDENCY_MISSING', `audio missing: ${wavPath}`);
    const cmd = this.commandTemplate.replace('{WAV}', JSON.stringify(wavPath));
    const tier = preflight(cmd);
    if (tier.tier === 'no') throw new ModelError('PERMISSION_DENIED', `stt command blocked by preflight: ${tier.reason}`, { provider: this.name });
    const parts = this.commandTemplate.split(/\s+/);
    const exe = parts.shift();
    const args = parts.map((a) => (a.includes('{WAV}') ? wavPath : a));
    const t0 = Date.now();
    return await new Promise((resolve, reject) => {
      execFile(exe, args.map((a) => a.replace(/^"|"$/g, '')), { timeout: this.timeoutMs, windowsHide: true }, (err, stdout) => {
        if (err) {
          const cls = /timeout|SIGTERM|ETIMED/i.test(String(err.message))
            ? 'TIMEOUT'
            : /spawn|ENOENT/i.test(String(err.message)) ? 'DEPENDENCY_MISSING' : 'MODEL_FAILURE';
          reject(new ModelError(cls, `stt command failed: ${err.message}`, { provider: this.name }));
          return;
        }
        resolve({ transcript: String(stdout).trim(), provider: this.name, elapsedMs: Date.now() - t0 });
      });
    });
  }
}

/** deterministic offline: maps known fixtures; everything else = empty transcript */
export class BufferSttProvider {
  constructor(fixtures = {}) { this.name = 'buffer'; this.kind = 'offline'; this.fixtures = fixtures; }
  async transcribe(wavPath) {
    if (!fs.existsSync(wavPath)) throw new ModelError('DEPENDENCY_MISSING', `audio missing: ${wavPath}`);
    const mapped = this.fixtures[path.basename(wavPath)];
    return { transcript: mapped || '', provider: this.name, elapsedMs: 0 };
  }
}
