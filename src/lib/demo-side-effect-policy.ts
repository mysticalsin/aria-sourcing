/** Pure policy predicate, kept separate so it can be tested without Next.js. */
export function isPublicDemoSideEffectBlocked(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === "true";
}
