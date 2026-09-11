/**
 * LinkedIn session health helpers — classify auth walls and probe results.
 * Keep in sync with scripts/lib/openbot-session-health.mjs
 */

export function looksLikeLinkedInAuthWall(text: string, title = "", url = ""): boolean {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  return (
    blob.includes("/login") ||
    blob.includes("login-cap") ||
    blob.includes("authwall") ||
    blob.includes("checkpoint") ||
    blob.includes("sign in") ||
    blob.includes("s’identifier") ||
    blob.includes("s'identifier") ||
    blob.includes("join linkedin") ||
    blob.includes("s’inscrire") ||
    blob.includes("s'inscrire") ||
    blob.includes("enter the code") ||
    blob.includes("two-step") ||
    blob.includes("2fa") ||
    blob.includes("verify your identity") ||
    blob.includes("suspicious activity") ||
    (blob.includes("session_redirect") && blob.includes("login"))
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

function looksLikeLoggedInRecruiter(url = "", title = "", text = ""): boolean {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  if (looksLikeLinkedInAuthWall(text, title, url)) return false;
  // Bare /talent/home is not enough — LinkedIn serves marketing shells there.
  const deepRecruiter =
    /\/talent\/(?:hire|inbox|search|pipeline|projects)/i.test(url) ||
    /\/recruiter\//i.test(url) ||
    /\/cap\//i.test(url);
  const strongSignals =
    blob.includes("projects") ||
    blob.includes("pipeline") ||
    blob.includes("candidates") ||
    blob.includes("candidate search") ||
    blob.includes("inbox") ||
    blob.includes("job openings") ||
    blob.includes("hiring projects");
  return deepRecruiter && strongSignals;
}

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
  if (isLinkedInRecruiterUrl(url)) {
    if (looksLikeLoggedInRecruiter(url, title, text)) {
      return {
        healthy: true,
        detail: "LinkedIn Recruiter session appears logged in",
        url,
      };
    }
    return {
      healthy: false,
      detail:
        "Could not confirm LinkedIn Recruiter session — Take control and sign in to Recruiter (talent/home)",
      url,
    };
  }
  const onLinkedIn =
    /(?:^|\.)linkedin\.com/i.test(url) || /talent\.linkedin\.com/i.test(url);
  if (
    onLinkedIn &&
    (/\/(feed|messaging|mypremium)/i.test(url) ||
      /\/in\//i.test(url) ||
      (/linkedin/i.test(title) && /\/(feed|messaging)/i.test(url)))
  ) {
    return {
      healthy: true,
      detail: "LinkedIn session appears logged in",
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
