/**
 * LinkedIn session health helpers — classify auth walls and probe results.
 * Keep in sync with scripts/lib/openbot-session-health.mjs
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

export function isLinkedInRecruiterUrl(url = ""): boolean {
  return /linkedin\.com\/(?:talent|recruiter|cap\/)/i.test(url) || /talent\.linkedin\.com/i.test(url);
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
  const onLinkedIn =
    /(?:^|\.)linkedin\.com/i.test(url) || /talent\.linkedin\.com/i.test(url);
  if (
    onLinkedIn &&
    (/\/(feed|messaging|talent|recruiter|cap\/|mypremium)/i.test(url) ||
      /\/in\//i.test(url) ||
      /linkedin|recruiter/i.test(title))
  ) {
    return {
      healthy: true,
      detail: isLinkedInRecruiterUrl(url)
        ? "LinkedIn Recruiter session appears logged in"
        : "LinkedIn session appears logged in",
      url,
    };
  }
  return {
    healthy: false,
    detail:
      "Could not confirm LinkedIn session — Take control and open linkedin.com/feed or LinkedIn Recruiter",
    url,
  };
}
