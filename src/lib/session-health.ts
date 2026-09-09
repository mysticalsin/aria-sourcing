/**
 * LinkedIn session health helpers — classify auth walls and probe results.
 */

export function looksLikeLinkedInAuthWall(text: string, title = "", url = ""): boolean {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  return (
    blob.includes("/login") ||
    blob.includes("authwall") ||
    blob.includes("checkpoint") ||
    blob.includes("sign in") ||
    blob.includes("join linkedin") ||
    blob.includes("enter the code") ||
    blob.includes("two-step") ||
    blob.includes("2fa") ||
    blob.includes("verify your identity") ||
    blob.includes("suspicious activity")
  );
}

export type SessionProbeResult = {
  healthy: boolean;
  detail: string;
  url?: string;
};

/** Classify a navigate/snapshot probe without performing I/O. */
export function classifySessionProbe(input: {
  url?: string;
  title?: string;
  text?: string;
}): SessionProbeResult {
  const url = input.url ?? "";
  const title = input.title ?? "";
  const text = input.text ?? "";
  if (looksLikeLinkedInAuthWall(text, title, url)) {
    return {
      healthy: false,
      detail: "LinkedIn login/checkpoint wall detected",
      url,
    };
  }
  if (/linkedin\.com/i.test(url) && (/feed|messaging|in\//i.test(url) || /linkedin/i.test(title))) {
    return { healthy: true, detail: "LinkedIn session appears logged in", url };
  }
  return {
    healthy: false,
    detail: "Could not confirm LinkedIn session — Take control and open linkedin.com/feed",
    url,
  };
}
