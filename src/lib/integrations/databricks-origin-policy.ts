type DatabricksOriginEnv = { DATABRICKS_ALLOWED_ORIGINS?: string };

/**
 * Convert a Databricks workspace URL into the one origin form accepted by the
 * integration. Paths, custom ports, credentials, queries, and fragments are
 * rejected so allowlist comparison cannot be bypassed through URL ambiguity.
 */
export function canonicalDatabricksOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash || url.port) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Databricks credentials may only be sent to deployment-owned exact origins.
 * An absent, empty, or malformed allowlist denies every origin in every mode.
 */
export function isDatabricksOriginAllowed(
  input: string,
  env: DatabricksOriginEnv = {
    DATABRICKS_ALLOWED_ORIGINS: process.env.DATABRICKS_ALLOWED_ORIGINS,
  },
): boolean {
  const origin = canonicalDatabricksOrigin(input);
  if (!origin) return false;

  return (env.DATABRICKS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((candidate) => canonicalDatabricksOrigin(candidate.trim()))
    .some((candidate) => candidate === origin);
}
