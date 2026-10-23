# Ghost acceptance — 23 October 2026

**NOT READY.** Source-host acceptance is separate from the unsigned native Windows
distribution. Work remains on draft [PR #401](https://github.com/rssen-debug/MAJINCLI/pull/401).

## Verified on Ghost

* Backup/restore: 39 data files, 46,961 bytes, zero restore mismatches. Original
  source snapshot: 839 files matched; full Git bundle includes the existing stash.
  Original 23 selected configuration/key/history files still match their initial
  hashes after runtime tests. Private backup and keys are outside Git.
* Actual OpenCode `opencode-go / glm-5.3-flash`, streaming and verified file
  write/read passed; dependent graph: 8 model calls, peak concurrency 2. Actual
  production source-host inference also passed after restart, without changing
  credentials. See [model](evidence/ghost-live-model.json),
  [graph](evidence/ghost-live-orchestration.json) and
  [runtime evidence](evidence/ghost-acceptance.json).
* Loopback binding, private Tailscale HTTPS and anonymous API 401 verified.
  Two existing authenticated sessions see identical canonical history; six
  sessions survived restart. Actual forced child crash recovered under the
  supervisor (PID 7708 to 8304). This does not prove Windows login startup.
* CLI defaults/version paths now target V4 alpha.3; legacy is explicit.
  Modified PowerShell scripts parse on Windows PowerShell 5 after UTF-8 BOM repair.

## Mobile input defect

Commit `dd62b49b764e7fed99ae349809bb295e02d6b79d` fixes stale PWA styles
where author `display:grid` overrides hidden and the lightbox intercepts input.
A pre-fix Chromium test actually failed on that blocker. Versioned shell assets,
network-first shell retrieval restricted to the current cache, and modal display
only while open prevent stale CSS from recreating it. Hidden elements cannot
receive pointer events. VisualViewport resizes the app for the keyboard.

Chromium and WebKit touch tests verify composer focus, sent message and actual
file bytes, history/menu scrolling controls, image-modal open/close and microphone
button handling. The keyboard is simulated and recognition is stubbed. Modern
WebKit did not reproduce the old CSS counterfactual; its fixed interaction tests
passed. These are browser engines, not physical iPhone tests.

Owner retest on the real iPhone 13: **“funkar har du löst den på datorn också
appen?”** This confirms mobile chat usability. It does not provide itemized
voice, speaker, voice-interruption or 5G reconnect acceptance. The owner then
reported that Safari's microphone does not work; voice remains a blocking defect.

## iOS voice follow-up

The previous UI relied solely on Web Speech recognition. Safari recognition
depends on Siri being enabled ([WebKit](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/));
API presence therefore did not prove a working microphone. An upstream
[WebKit report](https://bugs.webkit.org/show_bug.cgi?id=321436) also documents
recognition hanging after playback; that is a plausible compatibility risk,
not a proven diagnosis of this specific phone.

The new iOS path uses getUserMedia and a complete MediaRecorder container,
preferring MP4 with feature detection ([WebKit recording documentation](https://webkit.org/blog/11353/mediarecorder-api/)).
Authenticated, CSRF-protected `/api/voice/transcribe` sends audio to the existing
shell-free V2 command provider. No buffer/fixture fallback is advertised as real
recognition. Ghost uses local faster-whisper base, CPU int8/two threads; PyAV
decodes AAC/MP4 and WebM without an ffmpeg executable. The model is provisioned
separately; live recognition cannot download models or send audio externally.

Foreground voice capture uses one stream and a 20 Hz energy detector, bounded
utterances/uploads, one server transcription at a time, 60-second idle cutoff,
and explicit release on background/offline/stop. Sustained speech cancels local
synthesis and requests active-turn cancellation. Echo cancellation is requested;
speaker echo rejection and natural barge-in are **not physically accepted**.
Permission denial is shown without automatic retry loops. A late permission grant
after stopping immediately releases the tracks. Failed STT closes capture rather
than accumulating audio or retrying indefinitely.

Automated speech generated locally by Windows' Swedish Microsoft Bengt voice was
recognized by the actual installed model: “Hej majen! Kan du öppna historiken och
visa mina senaste meddelanden?” This is synthetic speech recognition evidence,
not a recording from the owner's microphone. Browser tests use real encoding
with an oscillator source; the Windows WebKit build lacks media APIs and its
recording test is explicitly skipped. The real Safari microphone, playback,
echo handling, interruption, latency and battery behavior still require the
owner's iPhone 13 test. **Do not mark physical voice PASS.**

## Regression results

Suites overlap and must not be added together.

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Legacy Ghost initial reproduction | 1234 | 43 | 23 |
| Legacy Ghost after Windows/fixture repairs | 1284 | 0 | 23 |
| V4 initial Ghost | 492 | 0 | 1 |
| Last full local V4 before installer assertion correction | 493 | 1 | 1 |
| Installer contracts after correcting that assertion | 15 | 0 | 0 |
| UI/history after mobile fix | 33 | 0 | 0 |
| Touch Chromium + WebKit | 2 | 0 | 0 |
| Voice follow-up: UI, capture, HTTP, actual browser encoding/client flow | 35 | 0 | 1 |

The voice browser skip is the Windows WebKit build lacking AudioContext and
MediaRecorder, not physical acceptance. The first combined parallel test run
had one oscillator startup timing failure; the test now waits for observed VAD
onset instead of assuming the audio graph is ready within 600 ms. Serial targeted
verification passed. The iOS-client test uses an iPhone user agent and real
Chromium encoding, a controlled transcript and synthesis stub; it verifies
chat/file delivery, interruption handler and background cleanup, not Safari audio.

All three CI workflows passed on mobile-fix commit `dd62b49b764e7fed99ae349809bb295e02d6b79d`:
[V4 CI](https://github.com/rssen-debug/MAJINCLI/actions/runs/40008883299),
[Windows desktop](https://github.com/rssen-debug/MAJINCLI/actions/runs/40008883360),
[Windows runner](https://github.com/rssen-debug/MAJINCLI/actions/runs/40008883359).
These are not CI results for the subsequent voice follow-up.

The old intermittent 401 was not reproduced; no claim of a proven root-cause
repair. V2 NTFS/OpenSSL repairs do not establish V4 cryptographic audit integration.
The new voice follow-up has its own targeted results and evidence, recorded
separately. Earlier parse check: 612/612 sources. Latest-head CI is mandatory.

## Exact remaining gates, without waivers

1. **Native distribution/signing:** CI alpha.3 artifact SHA256
   `df9a63f4db8da9e9042c1ee79d401de5d82f45ea6fc9d3bdf8e4d31b3ee0f615`
   is NotSigned. Windows application control blocked it on Ghost. No approved
   production signing identity/channel is available. No policy was disabled.
   The shared UI fix does not prove an installed native Ghost app.
2. **Login startup:** registered scheduled task failed with `0x8007010B`, then
   result 1 without working directory; a minimal signed-Node probe succeeded.
   Failed task disabled; functioning manual supervisor restored. Normal .ps1
   execution is policy-blocked. Actual Windows login startup remains unaccepted.
3. **Physical acceptance:** iPhone/Ghost microphone/speaker, natural voice
   interruption and echo behavior, explicit 5G handover/reconnect, cross-device
   upload/history walkthrough; Android and the full requested device coverage.
4. **Updates:** approved production host update activation/restart/rollback is
   unproven. Electron shell update/activation/rollback remains unimplemented.
5. **Parity:** outbound channels/proactive heartbeat, separate-store memory
   deltas/tombstones, typed self-configuration and preview/backup/confirmed reset,
   V4 audit chain/anchors/timestamp/export integration, durable graph pause/
   resume/replan, concurrent same-team checkpoint coordination, whole-team token/
   currency budgets. Existing tool-call budgets/cancellation do not waive these.
6. **Real integrations:** owner folder grants and model-driven desktop/browser
   upload/cancel/locked-desktop flows, configured MCP/skills/plugins/external
   services. Automated adapters do not prove every real configured service.
7. **Other original parity gaps:** scanned-PDF OCR, rich DOCX/XLSX previews,
   large-file behavior, native DPI/multimonitor, push/background delivery. Consult
   the full [parity table](FINAL_FEATURE_PARITY.md); no original requirement is removed.

Continue on this branch, preserving backups, settings and keys. Do not merge or
publish as production READY until all gates have concrete evidence.
