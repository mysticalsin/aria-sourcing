/**
 * Shared LinkedIn session classification for OpenBot supervisor probes.
 * Mirrors src/lib/session-health.ts (keep in sync).
 */

export function looksLikeLinkedInAuthWall(text = "", title = "", url = "") {
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

/** Member feed / messaging / profile OR Recruiter (talent) surfaces. */
export function isLinkedInAppSurface(url = "") {
  return (
    /(?:^|\.)linkedin\.com/i.test(url) ||
    /talent\.linkedin\.com/i.test(url)
  );
}

export function isLinkedInRecruiterUrl(url = "") {
  return /linkedin\.com\/(?:talent|recruiter|cap\/)/i.test(url) || /talent\.linkedin\.com/i.test(url);
}

export function classifySessionProbe(input = {}) {
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
  if (
    isLinkedInAppSurface(url) &&
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

export function defaultSessionProbeTarget(currentUrl = "") {
  if (isLinkedInRecruiterUrl(currentUrl)) {
    return "https://www.linkedin.com/talent/home";
  }
  return "https://www.linkedin.com/feed/";
}

export const LI_MEMBER_HOME = "https://www.linkedin.com/";
export const LI_MEMBER_LOGIN = "https://www.linkedin.com/login";
export const LI_RECRUITER_HOME = "https://www.linkedin.com/talent/home";
/** Recruiter login then land on talent home (human signs in like a normal browser). */
export const LI_RECRUITER_LOGIN =
  "https://www.linkedin.com/uas/login?session_redirect=%2Ftalent%2Fhome";
