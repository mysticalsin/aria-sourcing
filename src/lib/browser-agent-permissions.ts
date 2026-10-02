/**
 * Claude-in-Chrome–style permission modes for Aria Browser Computers.
 *
 * Mirrors the Claude Chrome extension options/permissions model
 * (chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/options.html):
 *   - manual  → ask / pause before bot LinkedIn actions (operator watches)
 *   - auto    → bot acts; still fail-closed on login/CAPTCHA/session unhealthy
 *   - skip    → same as auto for send pacing; never invents healthy sessions
 *
 * This is operator UX + policy for owned seats — not fingerprint spoofing.
 */

export const BROWSER_AGENT_PERMISSION_MODES = ["manual", "auto", "skip"] as const;
export type BrowserAgentPermissionMode = (typeof BROWSER_AGENT_PERMISSION_MODES)[number];

export const BROWSER_AGENT_PERMISSIONS_STORAGE_KEY = "aria.browserAgent.permissions.v1";

/** Hosts Aria may navigate on a Browser Computer without extra operator prompt. */
export const LINKEDIN_DEFAULT_ALLOWED_HOSTS = [
  "www.linkedin.com",
  "linkedin.com",
  "talent.linkedin.com",
] as const;

export type BrowserAgentPermissions = {
  /** Claude-style action approval mode. Default: auto. */
  mode: BrowserAgentPermissionMode;
  /** Hosts the seat Chromium may open while bot holds control. */
  allowedHosts: string[];
  /** When true, login/CAPTCHA/checkpoint always forces Take control (never invents healthy). */
  pauseOnChallenge: boolean;
  updatedAt: string;
};

export const DEFAULT_BROWSER_AGENT_PERMISSIONS: BrowserAgentPermissions = {
  mode: "auto",
  allowedHosts: [...LINKEDIN_DEFAULT_ALLOWED_HOSTS],
  pauseOnChallenge: true,
  updatedAt: new Date(0).toISOString(),
};

export function isBrowserAgentPermissionMode(value: unknown): value is BrowserAgentPermissionMode {
  return (
    typeof value === "string" &&
    (BROWSER_AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  );
}

export function normalizeAllowedHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.toLowerCase();
    if (!host || host.includes(" ")) return null;
    return host;
  } catch {
    // bare host without path
    if (/^[a-z0-9.-]+$/i.test(trimmed)) return trimmed;
    return null;
  }
}

export function parseBrowserAgentPermissions(raw: unknown): BrowserAgentPermissions {
  const base = { ...DEFAULT_BROWSER_AGENT_PERMISSIONS, allowedHosts: [...LINKEDIN_DEFAULT_ALLOWED_HOSTS] };
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const mode = isBrowserAgentPermissionMode(obj.mode) ? obj.mode : base.mode;
  const hostsRaw = Array.isArray(obj.allowedHosts) ? obj.allowedHosts : base.allowedHosts;
  const allowedHosts = [
    ...new Set(
      hostsRaw
        .map((h) => (typeof h === "string" ? normalizeAllowedHost(h) : null))
        .filter((h): h is string => Boolean(h)),
    ),
  ];
  return {
    mode,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : [...LINKEDIN_DEFAULT_ALLOWED_HOSTS],
    pauseOnChallenge: obj.pauseOnChallenge === false ? false : true,
    updatedAt:
      typeof obj.updatedAt === "string" && obj.updatedAt.trim()
        ? obj.updatedAt
        : new Date().toISOString(),
  };
}

export function loadBrowserAgentPermissions(): BrowserAgentPermissions {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS, allowedHosts: [...LINKEDIN_DEFAULT_ALLOWED_HOSTS] };
  }
  try {
    const raw = window.localStorage.getItem(BROWSER_AGENT_PERMISSIONS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS, allowedHosts: [...LINKEDIN_DEFAULT_ALLOWED_HOSTS] };
    }
    return parseBrowserAgentPermissions(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_BROWSER_AGENT_PERMISSIONS, allowedHosts: [...LINKEDIN_DEFAULT_ALLOWED_HOSTS] };
  }
}

export function saveBrowserAgentPermissions(
  next: Partial<BrowserAgentPermissions> & Pick<BrowserAgentPermissions, "mode">,
): BrowserAgentPermissions {
  const current = loadBrowserAgentPermissions();
  const merged = parseBrowserAgentPermissions({
    ...current,
    ...next,
    updatedAt: new Date().toISOString(),
  });
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(BROWSER_AGENT_PERMISSIONS_STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}

/** Host allow-check for bot navigation (LinkedIn only by default). */
export function isHostAllowedForBot(url: string, perms: BrowserAgentPermissions): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return perms.allowedHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

/**
 * Whether the bot should pause and hand the desk to the operator
 * (Claude "Manually approve" / challenge fail-closed).
 */
export function shouldPauseForOperator(opts: {
  mode: BrowserAgentPermissionMode;
  challengeDetected?: boolean;
  pauseOnChallenge?: boolean;
}): boolean {
  if (opts.challengeDetected && opts.pauseOnChallenge !== false) return true;
  return opts.mode === "manual";
}

export function permissionModeLabel(mode: BrowserAgentPermissionMode): string {
  switch (mode) {
    case "manual":
      return "Manually approve";
    case "auto":
      return "Automatically approve";
    case "skip":
      return "Skip approvals";
  }
}

export function permissionModeHint(mode: BrowserAgentPermissionMode): string {
  switch (mode) {
    case "manual":
      return "Watch the live desk. Take control (T) before LinkedIn actions; Esc to get out. Same spirit as Claude’s “Ask before acting”.";
    case "auto":
      return "After Outreach Approve, Aria drives the seat Chromium. Login/CAPTCHA still pauses for Take control — never invents a healthy session.";
    case "skip":
      return "Fewer confirmation prompts. Session health, caps, and checkpoint walls still fail closed.";
  }
}
