# Durable tool history — alpha.3 follow-up

The alpha.2 audit found that reloading a conversation removed its inline tool cards. The receipts themselves were already stored in the shared V2 goal store. Alpha.3 now includes the tool receipt metadata in the existing authenticated conversation response and rebuilds those cards from that durable source.

Both initial conversation opening and incremental cross-device refresh use the same renderer. Each receipt is shown once, before the answer that followed its recorded timestamp. Successful but unverified results remain unverified, failures retain their error class, and verified receipts are explicitly marked as historical. A note explains that the file or outside world may have changed since the recorded run. The response excludes raw inputs and evidence payloads; receipt targets are rendered as literal text.

The PWA shell cache advances to version 4. A conversation refresh that returns after the owner switches chats or starts streaming is ignored, preventing a stale response from replacing the current transcript.

Acceptance exercised against real local HTTP servers:

- Two separately authenticated sessions read the same receipt ID emitted by an actual verified write. The second session still reads it after the host restarts.
- Reloading the client restores the receipt even after the test deletes the original file; the UI describes the old verification rather than asserting present existence.
- Controlled failed and unverified receipts preserve their states on another session and after a history refresh. HTML-shaped targets remain literal text; raw evidence is absent; cards are not duplicated.
- Actual Chromium reloads at iPhone 13, Pixel 7, iPhone SE, iPad and desktop viewports restore historical verified cards. The test waits for the completed turn before reloading and also checks the saved file bytes.

These checks cover shared server history and browser rendering. They do not constitute physical iPhone/Android or Ghost acceptance. The alpha.2 installer does not contain this follow-up. Alpha.3 packaging and the full regression run must be verified separately. Production release status remains **NOT READY** for the other blockers in FINAL_RELEASE_REPORT.md and FINAL_FEATURE_PARITY.md.
