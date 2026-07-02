/* ============================================================================
   Aria Voice — a guarded wrapper over the browser's OWN SpeechRecognition
   (STT, Chromium-only) and SpeechSynthesis (TTS, broadly supported) APIs.

   Everything here is feature-detected and never throws: on a browser missing
   an API, isSTTSupported()/isTTSSupported() report false and
   startListening()/speak() degrade gracefully (reporting the miss via
   onError, where a caller is listening for it) instead of throwing. No
   network call is made anywhere in this module — SpeechRecognition and
   SpeechSynthesis are both native browser APIs; whatever a given browser's
   engine does internally to fulfil them is outside this app's code and
   outside this module's control.
   ========================================================================== */

/** Minimal shape of the (non-standard, Chromium-only) SpeechRecognition API —
 *  TypeScript's DOM lib doesn't ship types for it, so this module declares
 *  only the slice it actually uses rather than reaching for `any`. */
interface AriaSpeechRecognitionAlternative {
  readonly transcript: string;
}
interface AriaSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: AriaSpeechRecognitionAlternative;
}
interface AriaSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: AriaSpeechRecognitionResult;
}
interface AriaSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: AriaSpeechRecognitionResultList;
}
interface AriaSpeechRecognitionErrorEvent {
  readonly error: string;
}
interface AriaSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: AriaSpeechRecognitionEvent) => void) | null;
  onerror: ((event: AriaSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type AriaSpeechRecognitionCtor = new () => AriaSpeechRecognition;

function getRecognitionCtor(): AriaSpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: AriaSpeechRecognitionCtor;
    webkitSpeechRecognition?: AriaSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** True when this browser exposes (webkit)SpeechRecognition — Chromium
 *  (Chrome, Edge, Opera…) today; Firefox and Safari do not ship it. Callers
 *  must surface this as an explicit caveat, never assume support. */
export function isSTTSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

/** True when this browser exposes speechSynthesis — broadly supported
 *  (Chromium, Firefox, Safari all ship it), unlike STT. */
export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** At most one listening session at a time — module-level so stopListening()
 *  can always reach the live session regardless of which component started
 *  it (mirrors the single-flight pattern in demo/aria-live.ts). */
let activeRecognition: AriaSpeechRecognition | null = null;

/**
 * Starts one listening session. `onResult` fires on every result event —
 * `isFinal=false` for interim (live-transcript-chip) updates, `true` once the
 * browser has committed a final transcript for that utterance (after which
 * the session ends on its own). `onError` fires — and the session ends — on
 * anything from "no microphone" to "no speech detected"; callers must treat
 * any onError as "not listening anymore," never as a plan to run. No-ops
 * (reporting via onError) when SpeechRecognition isn't supported — never
 * throws.
 */
export function startListening(
  onResult: (transcript: string, isFinal: boolean) => void,
  onError: (message: string) => void,
): void {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    onError("Speech recognition isn't supported in this browser.");
    return;
  }
  try {
    stopListening();
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      try {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const alt = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += alt;
          else interimText += alt;
        }
        if (finalText.trim()) onResult(finalText.trim(), true);
        else if (interimText.trim()) onResult(interimText.trim(), false);
      } catch {
        /* a malformed event must never crash the recognizer's own handler */
      }
    };
    recognition.onerror = (event) => {
      activeRecognition = null;
      onError(event?.error ? `Speech recognition error: ${event.error}` : "Speech recognition error.");
    };
    recognition.onend = () => {
      activeRecognition = null;
    };
    activeRecognition = recognition;
    recognition.start();
  } catch {
    activeRecognition = null;
    onError("Couldn't start speech recognition.");
  }
}

/** Stops the current listening session, if any. Always safe to call — a
 *  no-op when nothing is listening. */
export function stopListening(): void {
  const recognition = activeRecognition;
  activeRecognition = null;
  if (!recognition) return;
  try {
    recognition.stop();
  } catch {
    /* best effort */
  }
}

/** Speaks one utterance via the browser's own speechSynthesis — cancels
 *  anything already queued/speaking first so summaries never stack up.
 *  No-ops silently when TTS isn't supported or `text` is blank. Never
 *  throws: TTS is cosmetic and must never break the calling flow. */
export function speak(text: string): void {
  if (!isTTSSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  } catch {
    /* best effort — TTS is cosmetic, never block on it */
  }
}
