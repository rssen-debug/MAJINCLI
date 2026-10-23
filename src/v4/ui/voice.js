/**
 * MAJIN V4 — voice policy, kept out of the DOM so it can be unit tested.
 *
 * Describes the Web Speech lane only. Foreground MediaRecorder/server STT
 * lives in recorder.js and needs an explicit microphone session. Neither
 * lane promises background listening or physical voice acceptance.
 */
import { t } from './strings.js?v=7';

/** Recognition language follows the phone, defaulting to Swedish. */
export function recognitionLang(navigatorLanguage = 'sv-SE') {
  const lang = String(navigatorLanguage || '').toLowerCase();
  if (lang.startsWith('sv')) return 'sv-SE';
  if (lang.startsWith('en')) return 'en-US';
  return 'sv-SE';
}

/** What the current browser can actually do. */
export function detectVoiceSupport(scope = globalThis) {
  const recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
  const synthesis = Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance);
  return {
    recognition: Boolean(recognition),
    synthesis,
    // Capability labels are deliberately precise.
    mode: recognition ? 'tap-to-talk' : 'text-only',
    continuous: false,
    bargeIn: false,
  };
}

/** Error code -> honest, actionable sentence. Empty string = stay silent. */
export function voiceErrorMessage(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return t('voice.blocked');
    case 'no-speech':
      return t('voice.noSpeech');
    case 'audio-capture':
      return t('voice.noMic');
    case 'network':
      return t('voice.needsNetwork');
    case 'aborted':
      return '';
    default:
      return code ? t('voice.error', { code }) : '';
  }
}

/** Auto-send only a final transcript, and never during an active turn. */
export function shouldAutoSend({ finalTranscript, autosend, streaming }) {
  return Boolean(finalTranscript && autosend && !streaming);
}

/** Strip markdown so speech does not read punctuation names aloud. */
export function speechText(text, maxChars = 1200) {
  return String(text || '')
    .replace(/[*`#_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}
