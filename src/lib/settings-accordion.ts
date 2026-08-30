/**
 * Settings accordion helpers — one open section per tab, hash deep-links
 * expand the owning section (Outreach Accounts → Integrations panel).
 */

/** Explicit order (do not derive from Object.keys — numeric-looking keys sort). */
export const SETTINGS_SECTION_ORDER = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "19",
  "18",
] as const;

/** Maps each numbered settings section to the tab it lives under. */
export const SETTINGS_N_TO_TAB: Record<string, string> = {
  "04": "integrations",
  "14": "ai",
  "15": "ai",
  "16": "ai",
  "17": "ai",
  "19": "ai",
  "03": "fleet",
  "06": "fleet",
  "09": "fleet",
  "18": "fleet",
  "02": "compliance",
  "05": "compliance",
  "07": "compliance",
  "08": "voice",
  "13": "voice",
  "11": "access",
  "12": "access",
  "01": "workspace",
  "10": "workspace",
};

/** DOM ids used in deep-links → section numeral that owns them. */
export const SETTINGS_HASH_TO_SECTION: Record<string, string> = {
  "microsoft365-stack": "04",
  "email-connections-panel": "04",
  "linkedin-outreach-stack": "04",
  "integrations-catalog": "04",
};

const SESSION_KEY = "aria.settings.openSection";

export function settingsSectionsForTab(tab: string): string[] {
  return SETTINGS_SECTION_ORDER.filter((n) => SETTINGS_N_TO_TAB[n] === tab);
}

export function settingsDefaultSectionForTab(tab: string): string | null {
  return settingsSectionsForTab(tab)[0] ?? null;
}

export function settingsSectionId(n: string): string {
  return `settings-section-${n}`;
}

export function settingsHeaderId(n: string): string {
  return `settings-header-${n}`;
}

export function settingsPanelId(n: string): string {
  return `settings-panel-${n}`;
}

/** Resolve which accordion section a URL hash should open. */
export function settingsSectionFromHash(hash: string): string | null {
  const cleaned = hash.replace(/^#/, "").trim();
  if (!cleaned) return null;
  if (SETTINGS_HASH_TO_SECTION[cleaned]) return SETTINGS_HASH_TO_SECTION[cleaned];
  const sectionMatch = /^settings-section-(.+)$/.exec(cleaned);
  if (sectionMatch && SETTINGS_N_TO_TAB[sectionMatch[1]]) return sectionMatch[1];
  return null;
}

/** Tab that owns a hash target, if known. */
export function settingsTabFromHash(hash: string): string | null {
  const section = settingsSectionFromHash(hash);
  return section ? SETTINGS_N_TO_TAB[section] ?? null : null;
}

/** Read last-open section for a tab from sessionStorage (client only). */
export function readSettingsOpenSectionSession(tab: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const n = parsed[tab];
    if (n && SETTINGS_N_TO_TAB[n] === tab) return n;
    return null;
  } catch {
    return null;
  }
}

/** Persist open section for a tab (session only — no cross-visit lock-in). */
export function writeSettingsOpenSectionSession(tab: string, n: string): void {
  if (typeof sessionStorage === "undefined") return;
  if (SETTINGS_N_TO_TAB[n] !== tab) return;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[tab] = n;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
  } catch {
    // Quota / private mode — ignore.
  }
}

/**
 * Neighbor section for keyboard accordion navigation within a tab.
 * ArrowDown/ArrowUp wrap; Home/End jump to ends.
 */
export function settingsNeighborSection(
  tab: string,
  current: string,
  direction: "next" | "prev" | "first" | "last",
): string | null {
  const siblings = settingsSectionsForTab(tab);
  if (siblings.length === 0) return null;
  if (direction === "first") return siblings[0] ?? null;
  if (direction === "last") return siblings[siblings.length - 1] ?? null;
  const idx = siblings.indexOf(current);
  if (idx < 0) return siblings[0] ?? null;
  if (direction === "next") return siblings[(idx + 1) % siblings.length] ?? null;
  return siblings[(idx - 1 + siblings.length) % siblings.length] ?? null;
}

/**
 * Pick the open accordion section for a tab.
 * Priority: hash (when on-tab) → currentOpen (when on-tab) → session → first section.
 */
export function resolveSettingsOpenSection(args: {
  tab: string;
  hash?: string | null;
  currentOpen?: string | null;
  sessionOpen?: string | null;
}): string | null {
  const { tab, hash, currentOpen, sessionOpen } = args;
  const fromHash = hash ? settingsSectionFromHash(hash) : null;
  if (fromHash && SETTINGS_N_TO_TAB[fromHash] === tab) return fromHash;
  if (currentOpen && SETTINGS_N_TO_TAB[currentOpen] === tab) return currentOpen;
  if (sessionOpen && SETTINGS_N_TO_TAB[sessionOpen] === tab) return sessionOpen;
  return settingsDefaultSectionForTab(tab);
}
