/**
 * Currency budget kill (A-10): when max_provider_spend_cents_per_day > 0 and
 * today's metered spend reaches the ceiling, trip the workspace kill_switch.
 * Count caps in sourcing_loop_controls still apply independently.
 */

export type SpendControls = {
  max_provider_spend_cents_per_day: number;
  kill_switch: boolean;
};

export type SpendTripDecision =
  | { trip: false; reason: "disabled" | "under-ceiling" | "already-killed" }
  | { trip: true; reason: "currency-ceiling"; spentCents: number; ceilingCents: number };

export function shouldTripCurrencyKill(
  controls: SpendControls,
  spentCentsToday: number,
): SpendTripDecision {
  const ceiling = Number(controls.max_provider_spend_cents_per_day ?? 0);
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return { trip: false, reason: "disabled" };
  }
  if (controls.kill_switch === true) {
    return { trip: false, reason: "already-killed" };
  }
  const spent = Number(spentCentsToday);
  if (!Number.isFinite(spent) || spent < ceiling) {
    return { trip: false, reason: "under-ceiling" };
  }
  return { trip: true, reason: "currency-ceiling", spentCents: spent, ceilingCents: ceiling };
}
