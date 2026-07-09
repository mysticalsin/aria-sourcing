export type AriaLiveRunPolicy =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Aria Live mutates the real workspace actions while it plays. Until a
 * side-effect-free adapter exists, it is only safe in an isolated local demo.
 */
export function getAriaLiveRunPolicy(supabaseConnected: boolean): AriaLiveRunPolicy {
  if (supabaseConnected) {
    return {
      ok: false,
      reason: "Aria Live is available only in an isolated local demo until a no-side-effect adapter exists.",
    };
  }
  return { ok: true };
}
