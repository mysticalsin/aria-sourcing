/**
 * Shared LinkedIn session classification for OpenBot supervisor probes.
 * Mirrors src/lib/session-health.ts (keep in sync).
 */

export function looksLikeLinkedInAuthWall(text = "", title = "", url = "") {
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
    blob.includes("session_redirect") && blob.includes("login")
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

function looksLikeLoggedInRecruiter(url = "", title = "", text = "") {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  // Soft marketing / logged-out talent landing is not a session.
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
  if (
    isLinkedInAppSurface(url) &&
    (/\/(feed|messaging|mypremium)/i.test(url) ||
      /\/in\//i.test(url) ||
      (/linkedin/i.test(title) && /\/feed|\/messaging/i.test(url)))
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
