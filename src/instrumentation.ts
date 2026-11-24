/** Runs once per server instance before it accepts requests (Next.js convention). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applyLocalSecret } = await import("@/lib/ai/local-secret");
  const applied = applyLocalSecret();
  // Names only: the values never reach a log.
  if (applied.length) console.info(`[ai] loaded ${applied.join(", ")} from .secret`);
}
