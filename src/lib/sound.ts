/* ============================================================================
   Tiny WebAudio sound engine — synthesizes short blips, no audio files.
   OFF by default: nothing plays unless `enabled` is true. Must be called from a
   user gesture (click) so the AudioContext can start.
   ========================================================================== */

export type SoundKind = "click" | "deploy" | "toggle" | "success" | "select";

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const NOTES: Record<SoundKind, number[]> = {
  click: [660],
  select: [520, 780],
  toggle: [440],
  deploy: [523, 659, 784], // C–E–G rising
  success: [659, 988],
};

/** Play a short blip. No-op unless `enabled`. Safe to call anywhere. */
export function playSound(kind: SoundKind, enabled: boolean): void {
  if (!enabled) return;
  const a = getCtx();
  if (!a) return;
  try {
    const now = a.currentTime;
    NOTES[kind].forEach((freq, i) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.07;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch {
    /* audio not available — silently ignore */
  }
}
