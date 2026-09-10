/**
 * Pure policy predicates for the public-demo kill switch.
 * Kept separate so they can be tested without Next.js.
 *
 * NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true turns on the public-demo dry-run wall for
 * third-party OAuth, mailbox sync, calendar, and generic durable delivery.
 *
 * ENABLE_PUBLIC_DEMO_ARIABOT=true is the Fly showcase escape hatch: first-party
 * AriaBot Browser Computer seat provisioning + LinkedIn delivery through that
 * seat stay live while demo login remains on.
 */

export function isPublicDemoSideEffectBlocked(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true";
}

/** True when AriaBot Browser Computer connect + LinkedIn send should stay live. */
export function isPublicDemoAriaBotAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.ENABLE_PUBLIC_DEMO_ARIABOT === "true";
}

/**
 * Block AriaBot / Browser Computer mutations only when public demo is on AND
 * the AriaBot showcase escape hatch is off.
 */
export function isPublicDemoAriaBotBlocked(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return isPublicDemoSideEffectBlocked(env) && !isPublicDemoAriaBotAllowed(env);
}
