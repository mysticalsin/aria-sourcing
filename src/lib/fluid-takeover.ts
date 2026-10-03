/**
 * Hyper-fluid Take control / get-out helpers (GrokBot + AgenticSeek style).
 *
 * Agents keep acting while you watch. One click (or T) jumps you in;
 * Escape / R returns control to the bot without fighting the stream.
 */

export const FLUID_TAKEOVER = {
  takeLabel: "Take control",
  releaseLabel: "Get out · Release",
  watchingHint:
    "Agent working — live view. Click Take control (or press T) to jump in.",
  controllingHint:
    "You have control — bot paused. Press Esc (or R) to get out and let the agent resume.",
  watchingChip: "Watching agent",
  controllingChip: "You control · Esc to get out",
} as const;

export type FluidHotkeyAction = "take" | "release" | "ignore";

/**
 * Map a keydown to take / release. Ignores events from inputs/omnibox so typing
 * into LinkedIn or the address bar never steals control.
 */
export function fluidHotkeyAction(
  key: string,
  opts: {
    humanControl: boolean;
    /** true when focus is in input/textarea/select/contenteditable */
    typingTarget?: boolean;
  },
): FluidHotkeyAction {
  if (opts.typingTarget) return "ignore";
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (opts.humanControl) {
    if (k === "Escape" || k === "escape" || k === "r") return "release";
    return "ignore";
  }
  if (k === "t") return "take";
  return "ignore";
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[contenteditable='true']"));
}

/** Append ?fs=1 so OpenBot auto-takes + fullscreen on load (GrokBot jump-in). */
export function withFluidTakeQuery(url: string): string {
  try {
    const u = new URL(url, "http://local.invalid");
    u.searchParams.set("fs", "1");
    if (url.startsWith("/")) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}fs=1`;
  }
}
