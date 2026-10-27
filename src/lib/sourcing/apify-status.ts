export interface ApifyRunStatus {
  status: string;
  blockedReason?: "account_limit";
}

export const APIFY_ACCOUNT_LIMIT_ERROR =
  "Apify reports that the actor's free-run limit has been reached. Check the account allowance in Apify before starting another search.";

/** Some actors finish successfully after refusing discovery. Preserve normal
 * empty searches, but classify the observed explicit refusal without exposing
 * arbitrary provider status messages (which can contain personal data). */
export function normalizeApifyRunStatus(raw?: { status?: unknown; statusMessage?: unknown }): ApifyRunStatus {
  const status = typeof raw?.status === "string" ? raw.status : "READY";
  const accountLimit = status === "SUCCEEDED" && typeof raw?.statusMessage === "string" &&
    /^free user run limit reached[.!]?$/i.test(raw.statusMessage.trim());
  return accountLimit ? { status, blockedReason: "account_limit" } : { status };
}
