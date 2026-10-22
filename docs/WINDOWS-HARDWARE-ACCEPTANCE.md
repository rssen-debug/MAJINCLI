# MAJIN V1 — Windows microphone and desktop acceptance

These are **physical-hardware** requirements. No CI simulation or scripted transcript is equivalent to real audio input/output.

## Windows evidence checklist
Use a clean Windows account or disposable VM for desktop tests. Use headphones AND loudspeakers.

1. Start the freshly installed MAJIN V1 and record application version and build commit.
2. Grant microphone permission in Edge/Chrome and verify sv-SE speech-to-text with 10 spoken turns.
3. Start a long MAJIN spoken response and interrupt by saying “nej vänta, öppna fyra jobb”. Confirm audio stops and the new transcript is kept. Repeat 10 times; record false triggers.
4. Repeat in en-US with 10 turns and 10 mid-speech interruptions.
5. Play MAJIN's voice over speakers: make 10 turns with no user voice and count self-triggered turns. Repeat on headphones.
6. Disconnect microphone, deny permission, and temporarily disconnect network. UI must show recoverable errors, never infinite “Thinking”.
7. Run a 20-minute continuous conversation. Record CPU %, peak RSS MB, p50/p95 interruption latency and end-of-user-speech -> first audio latency.
8. Perform desktop file/browser tasks **inside a disposable workspace**. Explicit approvals must prevent destructive actions.
9. Install MAJIN-Setup.exe over previous V1, verify version changed and settings persisted. Restart Windows, launch again, then uninstall. Record all steps.
10. Attach screenshots, redacted console logs, device model, timestamps, and results.

## Reporting contract
- PASS requires an actual observed test and its evidence.
- FAIL means observed violation.
- NOT_TESTED when physical access, recording equipment or evidence is missing.
- Never present simulated classifier or mock-agent success as real duplex voice readiness.

Suggested report path: `work/quality/windows-hardware.json`.
Example:
```json
{
  "version": "1.0.13",
  "os": "Windows",
  "device": "NOT_RECORDED",
  "microphoneSvSe": "NOT_TESTED",
  "microphoneEnUs": "NOT_TESTED",
  "speakerEcho": "NOT_TESTED",
  "bargeIn": "NOT_TESTED",
  "longSession": "NOT_TESTED",
  "desktopSafety": "NOT_TESTED",
  "installUpdateUninstall": "NOT_TESTED",
  "evidence": []
}
```
