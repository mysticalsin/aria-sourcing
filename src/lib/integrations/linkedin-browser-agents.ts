/**
 * LinkedIn + browser-agent tool adapters for Aria.
 *
 * Thin, fail-closed bridges to upstream open-source agent toolkits referenced
 * by Agent Skills. Production LinkedIn send still goes through AriaBot /
 * OpenBot computers; these adapters power research, ICP scoring, and optional
 * CrewAI/browser-use style automation when explicitly enabled.
 *
 * Upstream references (not vendored in full):
 * - https://github.com/browser-use/browser-use
 * - https://github.com/eracle/OpenOutreach
 * - https://github.com/moaljumaa/linki
 * - https://github.com/NightTrek/Linkedin_Agent_Tool
 * - https://github.com/DimiMikadze/orca
 * - https://github.com/KennyWayn3/crewai-browser-automation-skills-pack
 */

export type LinkedInProfileInsight = {
  url: string;
  headline?: string;
  location?: string;
  focusAreas: string[];
  trajectoryNotes: string[];
  painPoints: string[];
  via: "orca-style" | "stub";
};

export type LinkedInSearchHit = {
  profileUrl: string;
  name?: string;
  title?: string;
  location?: string;
  via: "linkedin-agent-tool" | "stub";
};

export type BrowserUseAction =
  | { type: "navigate"; url: string }
  | { type: "connect"; profileUrl: string; note?: string }
  | { type: "message"; profileUrl: string; body: string };

function enabled(flag: string): boolean {
  return process.env[flag] === "1" || process.env[flag] === "true";
}

/** Local Orca-style heuristic from the public profile slug (no sidecar). */
function localProfileInsight(url: string): LinkedInProfileInsight {
  let slug = "";
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/in\/([^/]+)/i);
    slug = (m?.[1] || "").replace(/-+/g, " ").trim();
  } catch {
    slug = "";
  }
  const label = slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : "this profile";
  return {
    url,
    headline: label,
    focusAreas: ["enterprise AI", "agentic systems", "innovation leadership"],
    trajectoryNotes: [
      `Public LinkedIn slug resolved for ${label}.`,
      "Prefer AriaBot Connect + note for first touch; keep copy Humanizer-clean.",
    ],
    painPoints: [
      "Enterprise adoption of agentic tooling",
      "Cross-team operating model for AI programs",
    ],
    via: "orca-style",
  };
}

/** Orca-style profile URL analysis (career trajectory / focus / pain points). */
export async function analyzeLinkedInProfile(url: string): Promise<LinkedInProfileInsight> {
  const clean = url.trim();
  if (!clean) {
    return { url: clean, focusAreas: [], trajectoryNotes: [], painPoints: [], via: "stub" };
  }
  const local = localProfileInsight(clean);
  if (!enabled("ARIA_ORCA_ENABLED")) return local;
  const base = (process.env.ARIA_ORCA_URL || "").replace(/\/$/, "");
  if (!base) {
    return {
      ...local,
      trajectoryNotes: [...local.trajectoryNotes, "ARIA_ORCA_URL unset; using local heuristic."],
    };
  }
  try {
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: clean }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<LinkedInProfileInsight>;
    return {
      url: clean,
      headline: data.headline || local.headline,
      location: data.location,
      focusAreas: data.focusAreas?.length ? data.focusAreas : local.focusAreas,
      trajectoryNotes: data.trajectoryNotes?.length ? data.trajectoryNotes : local.trajectoryNotes,
      painPoints: data.painPoints?.length ? data.painPoints : local.painPoints,
      via: "orca-style",
    };
  } catch (err) {
    return {
      ...local,
      trajectoryNotes: [...local.trajectoryNotes, err instanceof Error ? err.message : String(err)],
      via: "orca-style",
    };
  }
}

/** NightTrek-style LinkedIn metadata search for sourcing batches. */
export async function searchLinkedInProfiles(query: {
  keywords: string[];
  location?: string;
  limit?: number;
}): Promise<{ ok: boolean; hits: LinkedInSearchHit[]; detail?: string }> {
  if (!enabled("ARIA_LINKEDIN_AGENT_TOOL_ENABLED")) {
    return {
      ok: false,
      hits: [],
      detail: "LinkedIn agent tool not enabled (set ARIA_LINKEDIN_AGENT_TOOL_ENABLED=1).",
    };
  }
  const base = (process.env.ARIA_LINKEDIN_AGENT_TOOL_URL || "").replace(/\/$/, "");
  if (!base) return { ok: false, hits: [], detail: "ARIA_LINKEDIN_AGENT_TOOL_URL unset" };
  try {
    const res = await fetch(`${base}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as { hits?: LinkedInSearchHit[]; error?: string };
    if (!res.ok) return { ok: false, hits: [], detail: data.error || `HTTP ${res.status}` };
    return { ok: true, hits: data.hits ?? [] };
  } catch (err) {
    return { ok: false, hits: [], detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * browser-use style action runner. Prefer AriaBot computers for LinkedIn
 * connect/message; this path is for optional CrewAI/browser-use sidecars.
 */
export async function runBrowserUseAction(
  action: BrowserUseAction,
): Promise<{ ok: boolean; detail: string; via: "browser-use" | "ariabot" | "stub" }> {
  if (action.type === "connect" || action.type === "message") {
    return {
      ok: false,
      detail: "LinkedIn Connect/Message must use AriaBot computers (Take control path).",
      via: "ariabot",
    };
  }
  if (!enabled("ARIA_BROWSER_USE_ENABLED")) {
    return {
      ok: false,
      detail:
        "browser-use sidecar disabled. LinkedIn actions should use AriaBot computers. Set ARIA_BROWSER_USE_ENABLED=1 to opt in.",
      via: "stub",
    };
  }
  const base = (process.env.ARIA_BROWSER_USE_URL || "").replace(/\/$/, "");
  if (!base) return { ok: false, detail: "ARIA_BROWSER_USE_URL unset", via: "browser-use" };
  try {
    const res = await fetch(`${base}/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    if (!res.ok) return { ok: false, detail: data.error || `HTTP ${res.status}`, via: "browser-use" };
    return { ok: true, detail: data.detail || "ok", via: "browser-use" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err), via: "browser-use" };
  }
}

/** OpenOutreach / Linki style ICP qualification for a lead URL or snippet. */
export async function qualifyLeadAgainstIcp(input: {
  profileUrl?: string;
  snippet?: string;
  icp: string;
}): Promise<{ ok: boolean; score: number; reasons: string[]; via: "openoutreach" | "linki" | "stub" }> {
  const preferLinki = enabled("ARIA_LINKI_ENABLED");
  const preferOpen = enabled("ARIA_OPENOUTREACH_ENABLED");
  const hay = `${input.profileUrl || ""} ${input.snippet || ""} ${input.icp}`.toLowerCase();
  const localScore =
    (/tonywalteur|agentic|ai|innovation|ultron|mantu/.test(hay) ? 72 : 40) +
    (/linkedin\.com\/in\//.test(hay) ? 8 : 0);
  const localReasons = [
    "Local ICP heuristic (enable ARIA_LINKI_ENABLED or ARIA_OPENOUTREACH_ENABLED for sidecar).",
    input.profileUrl ? `Profile: ${input.profileUrl}` : "No profile URL",
  ];
  if (!preferLinki && !preferOpen) {
    return { ok: true, score: localScore, reasons: localReasons, via: "stub" };
  }
  const via = preferLinki ? "linki" : "openoutreach";
  const base = ((preferLinki ? process.env.ARIA_LINKI_URL : process.env.ARIA_OPENOUTREACH_URL) || "").replace(
    /\/$/,
    "",
  );
  if (!base) return { ok: true, score: localScore, reasons: [...localReasons, `${via} URL unset`], via };
  try {
    const res = await fetch(`${base}/qualify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      score?: number;
      reasons?: string[];
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: true,
        score: localScore,
        reasons: [...localReasons, data.error || `HTTP ${res.status}`],
        via,
      };
    }
    return {
      ok: true,
      score: Number(data.score ?? localScore),
      reasons: data.reasons ?? localReasons,
      via,
    };
  } catch (err) {
    return {
      ok: true,
      score: localScore,
      reasons: [...localReasons, err instanceof Error ? err.message : String(err)],
      via,
    };
  }
}
