import {
  resolveSettingsOpenSection,
  SETTINGS_N_TO_TAB,
  settingsTabFromHash,
} from "@/lib/settings-accordion";

export const SETTINGS_CONSOLE_TABS = [
  "integrations",
  "ai",
  "fleet",
  "compliance",
  "voice",
  "access",
  "workspace",
] as const;

const TAB_SET = new Set<string>(SETTINGS_CONSOLE_TABS);

export interface SettingsConsoleState {
  tab: string;
  openSection: string | null;
}

export type SettingsConsoleEffect =
  | { type: "persist-section"; tab: string; section: string }
  | { type: "replace-url"; tab: string; hash: string | null }
  | { type: "scroll"; hash: string };

export type SettingsConsoleEvent =
  | { type: "go-tab"; tab: string; hash?: string | null }
  | { type: "open-section"; section: string }
  | { type: "apply-location"; tabParam: string | null; hash: string }
  | { type: "hash-change"; tabParam: string | null; hash: string; currentTab: string };

export type SettingsSessionReader = (tab: string) => string | null;

export function initialSettingsConsole(): SettingsConsoleState {
  return {
    tab: "integrations",
    openSection: resolveSettingsOpenSection({ tab: "integrations" }),
  };
}

function bareHash(hash: string | null | undefined): string {
  return (hash ?? "").replace(/^#/, "");
}

function noopSession(): string | null {
  return null;
}

/**
 * Settings tab + accordion. Session lookup is injected so the transition
 * stays pure. Effects are the URL write, the session write, and the scroll
 * the page already performed.
 */
export function reduceSettingsConsole(
  state: SettingsConsoleState,
  event: SettingsConsoleEvent,
  readSession: SettingsSessionReader = noopSession,
): { state: SettingsConsoleState; effects: SettingsConsoleEffect[] } {
  switch (event.type) {
    case "go-tab": {
      if (!TAB_SET.has(event.tab)) return { state, effects: [] };
      const hash = bareHash(event.hash) || null;
      const nextOpen = resolveSettingsOpenSection({
        tab: event.tab,
        hash,
        currentOpen: null,
        sessionOpen: hash ? null : readSession(event.tab),
      });
      const effects: SettingsConsoleEffect[] = [];
      if (nextOpen) effects.push({ type: "persist-section", tab: event.tab, section: nextOpen });
      effects.push({ type: "replace-url", tab: event.tab, hash });
      if (hash) effects.push({ type: "scroll", hash });
      return { state: { tab: event.tab, openSection: nextOpen }, effects };
    }
    case "open-section": {
      const tab = SETTINGS_N_TO_TAB[event.section];
      const effects: SettingsConsoleEffect[] = tab
        ? [{ type: "persist-section", tab, section: event.section }]
        : [];
      return { state: { ...state, openSection: event.section }, effects };
    }
    case "apply-location": {
      const hash = bareHash(event.hash);
      const tabParam = event.tabParam;
      const resolvedTab =
        (tabParam && TAB_SET.has(tabParam) ? tabParam : null) ??
        settingsTabFromHash(hash) ??
        "integrations";
      const nextOpen = resolveSettingsOpenSection({
        tab: resolvedTab,
        hash: hash || null,
        currentOpen: null,
        sessionOpen: hash ? null : readSession(resolvedTab),
      });
      const effects: SettingsConsoleEffect[] = [];
      if (nextOpen) effects.push({ type: "persist-section", tab: resolvedTab, section: nextOpen });
      if (hash) effects.push({ type: "scroll", hash });
      if ((!tabParam || !TAB_SET.has(tabParam)) && settingsTabFromHash(hash)) {
        effects.push({ type: "replace-url", tab: resolvedTab, hash });
      }
      return { state: { tab: resolvedTab, openSection: nextOpen }, effects };
    }
    case "hash-change": {
      const hash = bareHash(event.hash);
      if (!hash) return { state, effects: [] };
      const tabFromHash = settingsTabFromHash(hash);
      const tab =
        tabFromHash ??
        (event.tabParam && TAB_SET.has(event.tabParam) ? event.tabParam : null) ??
        event.currentTab;
      const nextOpen = resolveSettingsOpenSection({
        tab,
        hash,
        currentOpen: null,
      });
      const effects: SettingsConsoleEffect[] = [];
      if (nextOpen) effects.push({ type: "persist-section", tab, section: nextOpen });
      if (event.tabParam !== tab) effects.push({ type: "replace-url", tab, hash });
      effects.push({ type: "scroll", hash });
      return { state: { tab, openSection: nextOpen }, effects };
    }
    default:
      return { state, effects: [] };
  }
}
