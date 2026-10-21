# MAJIN local neural narrator (Windows opt-in)

This is **not a SunnyV2 voice clone**. It is a natural-sounding English narrator style powered by the openly available Kokoro ONNX engine. MAJIN continues to support Swedish microphone dictation through Windows/Chromium SpeechRecognition.

## Setup

From MAJIN's repository in Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-kokoro-voice.ps1
python .\scripts\majin-kokoro-voice.py --voice am_adam
```

Keep that local service window open. In MAJIN's UI switch on **Voice** and **Narrator EN**, then enable **Talk** for a hands-free conversation. Ask the agent to reply in English for the best narration quality. On the first reply, the app POSTs the response text to a local CPU inference service at `127.0.0.1:18765`, plays its returned WAV and then listens again if hands-free remains enabled.

The service only binds to loopback, restricts web origins to loopback, truncates inputs, never stores or uploads audio and only runs after you start it. The voice model is downloaded separately rather than bundled in the MAJIN installer. Verify the upstream model's redistribution terms and the voice model card before distributing binary assets. For installations without Kokoro, speech falls back to the system voice.

## Verification scope

Unit tests validate interface wiring and Python source; actual audio quality, microphone permissions, audio-device playback and latency need manual end-to-end Windows verification. Do not claim these are already proven by CI. No tool or library here imitates a specific real narrator's voiceprint.

Source: https://github.com/thewh1teagle/kokoro-onnx
