"use client";

import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  Eyebrow,
  SectionNumeral,
  Field,
  Input,
  Select,
  Switch,
  Button,
  Badge,
  EmptyState,
  SkeletonCard,
  useToast,
  useConfirm,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { IntegrationCard } from "@/components/settings/integration-card";
import { CompliancePanel } from "@/components/settings/compliance-panel";
import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { RolesPanel } from "@/components/settings/roles-panel";
import { GuardrailsPanel } from "@/components/settings/guardrails-panel";
import { ProvidersPanel } from "@/components/settings/providers-panel";
import { ModelsPanel } from "@/components/settings/models-panel";
import { ToolsPanel } from "@/components/settings/tools-panel";
import { McpServersPanel } from "@/components/settings/mcp-servers-panel";
import { DustAgentPanel } from "@/components/settings/dust-agent-panel";
import { DatabricksPanel } from "@/components/settings/databricks-panel";
import { HermesRuntimePanel } from "@/components/settings/hermes-runtime-panel";
import { SchedulesPanel } from "@/components/settings/schedules-panel";
import { HermesSchedulesPanel } from "@/components/settings/hermes-schedules-panel";
import { useHydrated, useSettings, useIntegrations, useActions } from "@/lib/store";
import type { SystemSettings } from "@/lib/types";
import { integrationHealthSummary } from "@/lib/integrations";
import { supabaseEnabled } from "@/lib/supabase/config";
import { LANGUAGES } from "@/lib/i18n";
import {
  ShieldCheck,
  Lock,
  RotateCcw,
  Slack,
  Send,
  Mail,
  Plug2,
  EyeOff,
  Sparkles,
  Users,
  ArrowUpRight,
  Clock,
  Shuffle,
  Cpu,
  BrainCircuit,
  Wrench,
  Info,
  ChevronDown,
} from "lucide-react";
import {
  SETTINGS_N_TO_TAB,
  readSettingsOpenSectionSession,
  resolveSettingsOpenSection,
  settingsHeaderId,
  settingsNeighborSection,
  settingsPanelId,
  settingsSectionId,
  settingsSectionsForTab,
  settingsTabFromHash,
  writeSettingsOpenSectionSession,
} from "@/lib/settings-accordion";

/* ---- tabbed navigation -------------------------------------------------- */

const SettingsTabContext = React.createContext("integrations");

type AccordionCtx = {
  openSection: string | null;
  setOpenSection: (n: string) => void;
  focusSectionHeader: (n: string) => void;
};

const SettingsAccordionContext = React.createContext<AccordionCtx>({
  openSection: null,
  setOpenSection: () => {},
  focusSectionHeader: () => {},
});

const VALID_TABS = new Set([
  "integrations",
  "ai",
  "fleet",
  "compliance",
  "voice",
  "access",
  "workspace",
]);

const TABS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: "integrations", label: "Integrations", icon: <Plug2 className="h-4 w-4" /> },
  { id: "ai", label: "AI & Models", icon: <Cpu className="h-4 w-4" /> },
  { id: "fleet", label: "Fleet & Automation", icon: <Clock className="h-4 w-4" /> },
  { id: "compliance", label: "Approval & Compliance", icon: <ShieldCheck className="h-4 w-4" /> },
  { id: "voice", label: "Brand Voice", icon: <Sparkles className="h-4 w-4" /> },
  { id: "access", label: "Access & Keys", icon: <Lock className="h-4 w-4" /> },
  { id: "workspace", label: "Workspace", icon: <Users className="h-4 w-4" /> },
];

/* ---- small presentational helpers --------------------------------------- */

function Section({
  n,
  eyebrow,
  title,
  description,
  children,
}: {
  n: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const activeTab = React.useContext(SettingsTabContext);
  const { openSection, setOpenSection, focusSectionHeader } =
    React.useContext(SettingsAccordionContext);
  if (SETTINGS_N_TO_TAB[n] && SETTINGS_N_TO_TAB[n] !== activeTab) return null;

  const siblings = settingsSectionsForTab(activeTab);
  const isSolo = siblings.length <= 1;
  const isOpen = isSolo || openSection === n;
  const panelId = settingsPanelId(n);
  const headerId = settingsHeaderId(n);

  const onAccordionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    let direction: "next" | "prev" | "first" | "last" | null = null;
    if (e.key === "ArrowDown") direction = "next";
    else if (e.key === "ArrowUp") direction = "prev";
    else if (e.key === "Home") direction = "first";
    else if (e.key === "End") direction = "last";
    if (!direction) return;
    e.preventDefault();
    const target = settingsNeighborSection(activeTab, n, direction);
    if (!target) return;
    setOpenSection(target);
    focusSectionHeader(target);
  };

  // Solo tabs: dense always-open panel (no accordion chrome).
  if (isSolo) {
    return (
      <section
        id={settingsSectionId(n)}
        className="scroll-mt-20 border-t border-line py-4 first:border-t-0 first:pt-0"
      >
        <div className="mb-3 flex items-start gap-3">
          <SectionNumeral n={n} />
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="display text-lg text-ink sm:text-xl">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          </div>
        </div>
        <div className="space-y-3">{children}</div>
      </section>
    );
  }

  return (
    <section
      id={settingsSectionId(n)}
      className="scroll-mt-20 border-t border-line first:border-t-0"
    >
      <h2 className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setOpenSection(n)}
          onKeyDown={onAccordionKeyDown}
          className={cn(
            "flex w-full items-center gap-3 py-2.5 text-left transition-colors",
            "hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
            isOpen ? "bg-ink/[0.02]" : "",
          )}
        >
          <SectionNumeral n={n} />
          <div className="min-w-0 flex-1">
            <Eyebrow>{eyebrow}</Eyebrow>
            <span className="display block text-base text-ink sm:text-lg">{title}</span>
            <span
              className={cn(
                "mt-0.5 line-clamp-1 block text-xs text-muted",
                isOpen && "invisible",
              )}
              aria-hidden={isOpen}
            >
              {description}
            </span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h2>
      <AccordionPanel id={panelId} headerId={headerId} isOpen={isOpen}>
        <p className="text-sm text-muted">{description}</p>
        {children}
      </AccordionPanel>
    </section>
  );
}

function AccordionPanel({
  id,
  headerId,
  isOpen,
  children,
}: {
  id: string;
  headerId: string;
  isOpen: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(isOpen);
  React.useEffect(() => {
    if (isOpen) setMounted(true);
  }, [isOpen]);
  return (
    <div
      id={id}
      role="region"
      aria-labelledby={headerId}
      hidden={!isOpen}
      className="space-y-3 pb-4 pt-1"
    >
      {mounted ? children : null}
    </div>
  );
}

function ToggleRow({
  id,
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-soft" aria-hidden>
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-semibold text-ink">
            {label}
          </label>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        label={label}
        disabled={disabled}
      />
    </div>
  );
}

/* A few of the AI-isms the always-on Humanizer strips from every draft. */
const BANNED_AI_ISMS = [
  "leverage",
  "utilize",
  "seamless",
  "robust",
  "delve into",
  "elevate",
  "cutting-edge",
  "game-changer",
  "synergy",
  "thrilled",
  "em-dashes",
  "“I hope this email finds you well”",
];

/* ---- page --------------------------------------------------------------- */

export default function SettingsPage() {
  const hydrated = useHydrated();
  const settings = useSettings();
  const storedIntegrations = useIntegrations();
  // The Supabase card's stored status is seed data, frozen at whatever it was
  // when this workspace was first created — it can never reflect a later env
  // change. Override it live from the actual runtime flag every render, same
  // way login/persistence already gate on `supabaseEnabled` elsewhere, so the
  // card can't say "not configured" while the app is demonstrably running on
  // live Supabase (or the reverse).
  const integrations = React.useMemo(
    () =>
      storedIntegrations.map((i) =>
        i.id === "int_supabase"
          ? {
              ...i,
              status: supabaseEnabled ? ("connected" as const) : ("not_configured" as const),
              mode: supabaseEnabled ? ("live" as const) : ("mock" as const),
              real: true,
              errors: supabaseEnabled ? [] : ["No project URL configured: demo runs on localStorage."],
            }
          : i,
      ),
    [storedIntegrations],
  );
  const actions = useActions();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = React.useState("integrations");
  const [openSection, setOpenSectionState] = React.useState<string | null>(() =>
    resolveSettingsOpenSection({ tab: "integrations" }),
  );
  const pendingScrollHashRef = React.useRef<string | null>(null);
  const scrollGenerationRef = React.useRef(0);
  const canResetSyntheticDemo = !supabaseEnabled;

  const queueHashScroll = React.useCallback((hash: string | null | undefined) => {
    const cleaned = hash?.replace(/^#/, "").trim() || null;
    pendingScrollHashRef.current = cleaned;
    scrollGenerationRef.current += 1;
  }, []);

  const focusSectionHeader = React.useCallback((n: string) => {
    if (typeof document === "undefined") return;
    window.requestAnimationFrame(() => {
      document.getElementById(settingsHeaderId(n))?.focus();
    });
  }, []);

  const setOpenSection = React.useCallback((n: string) => {
    setOpenSectionState(n);
    const tab = SETTINGS_N_TO_TAB[n];
    if (tab) writeSettingsOpenSectionSession(tab, n);
  }, []);

  const goTab = React.useCallback(
    (id: string, opts?: { hash?: string | null }) => {
      if (!VALID_TABS.has(id)) return;
      const hash = opts?.hash?.replace(/^#/, "") || null;
      const nextOpen = resolveSettingsOpenSection({
        tab: id,
        hash,
        currentOpen: null,
        sessionOpen: hash ? null : readSettingsOpenSectionSession(id),
      });
      setActiveTab(id);
      setOpenSectionState(nextOpen);
      if (nextOpen) writeSettingsOpenSectionSession(id, nextOpen);
      if (hash) queueHashScroll(hash);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", id);
        window.history.replaceState(
          {},
          "",
          hash
            ? `${url.pathname}?${url.searchParams.toString()}#${hash}`
            : `${url.pathname}?${url.searchParams.toString()}`,
        );
      }
    },
    [queueHashScroll],
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const hash = window.location.hash.replace(/^#/, "");
    const resolvedTab =
      (tabParam && VALID_TABS.has(tabParam) ? tabParam : null) ??
      settingsTabFromHash(hash) ??
      "integrations";
    const nextOpen = resolveSettingsOpenSection({
      tab: resolvedTab,
      hash: hash || null,
      currentOpen: null,
      sessionOpen: hash ? null : readSettingsOpenSectionSession(resolvedTab),
    });
    setActiveTab(resolvedTab);
    setOpenSectionState(nextOpen);
    if (nextOpen) writeSettingsOpenSectionSession(resolvedTab, nextOpen);
    if (hash) queueHashScroll(hash);

    if ((!tabParam || !VALID_TABS.has(tabParam)) && settingsTabFromHash(hash)) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", resolvedTab);
      window.history.replaceState(
        {},
        "",
        `${url.pathname}?${url.searchParams.toString()}${hash ? `#${hash}` : ""}`,
      );
    }

    const oauth = params.get("oauth");
    const message = params.get("message");
    if (oauth === "success") {
      toast({ title: "Mailbox connected", description: message ?? "", variant: "success" });
      goTab("integrations", { hash: "email-connections-panel" });
    } else if (oauth === "error") {
      toast({ title: "Mailbox connection failed", description: message ?? "", variant: "error" });
      goTab("integrations");
    }
  }, [toast, goTab, queueHashScroll]);

  React.useEffect(() => {
    const hash = pendingScrollHashRef.current;
    if (!hash || typeof document === "undefined") return;
    const generation = scrollGenerationRef.current;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled || generation !== scrollGenerationRef.current) return;
      const el = document.getElementById(hash);
      if (el) {
        pendingScrollHashRef.current = null;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 20) {
        window.requestAnimationFrame(tryScroll);
      }
    };
    window.requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [activeTab, openSection, hydrated]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    function onHashChange() {
      const hash = window.location.hash.replace(/^#/, "");
      if (!hash) return;
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      const tabFromHash = settingsTabFromHash(hash);
      const tab =
        tabFromHash ??
        (tabParam && VALID_TABS.has(tabParam) ? tabParam : null) ??
        activeTab;
      const nextOpen = resolveSettingsOpenSection({
        tab,
        hash,
        currentOpen: null,
      });
      setActiveTab(tab);
      setOpenSectionState(nextOpen);
      if (nextOpen) writeSettingsOpenSectionSession(tab, nextOpen);
      if (tabParam !== tab) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState(
          {},
          "",
          `${url.pathname}?${url.searchParams.toString()}#${hash}`,
        );
      }
      queueHashScroll(hash);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [activeTab, queueHashScroll]);

  const summary = integrationHealthSummary(integrations);

  function savedToast() {
    toast({ title: "Settings saved", variant: "success" });
  }

  function setToggle(patch: Partial<SystemSettings>, label: string, on: boolean) {
    actions.updateSettings(patch);
    toast({
      title: `${label} ${on ? "enabled" : "disabled"}`,
      variant: on ? "success" : "info",
    });
  }

  function patchRate(key: keyof SystemSettings["rateLimits"], value: number) {
    actions.updateSettings({ rateLimits: { ...settings.rateLimits, [key]: value } });
  }

  function patchNotify(key: keyof SystemSettings["notifications"], value: boolean) {
    actions.updateSettings({ notifications: { ...settings.notifications, [key]: value } });
    toast({
      title: `${key === "slack" ? "Slack" : key === "telegram" ? "Telegram" : "Email"} alerts ${
        value ? "enabled" : "disabled"
      }`,
      variant: value ? "success" : "info",
    });
  }

  function patchFleet(patch: Partial<SystemSettings["fleet"]>) {
    actions.updateSettings({ fleet: { ...settings.fleet, ...patch } });
  }

  function toggleFleet(key: keyof SystemSettings["fleet"], label: string, on: boolean) {
    patchFleet({ [key]: on } as Partial<SystemSettings["fleet"]>);
    toast({ title: `${label} ${on ? "enabled" : "disabled"}`, variant: on ? "success" : "info" });
  }

  // Thresholds are stored as 0–1 fractions; surfaced to operators as percentages.
  const bouncePct = Math.round(settings.fleet.bounceRatePauseThreshold * 1000) / 10;
  const complaintPct = Math.round(settings.fleet.complaintRatePauseThreshold * 1000) / 10;

  async function handleReset() {
    if (!canResetSyntheticDemo) {
      toast({ title: "Live workspace reset blocked", description: "Synthetic demo reset is not available in live workspaces.", variant: "warning" });
      return;
    }
    if (!(await confirm({ title: "Reset synthetic demo?", description: "This restores local synthetic demo data only. It cannot be used on a live workspace.", confirmLabel: "Reset demo", danger: true }))) {
      return;
    }
    actions.resetDemo();
    toast({
      title: "Synthetic demo reset",
      description: "Campaigns, candidates, and settings are back to synthetic demo data. No live workspace was changed.",
      variant: "info",
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Control"
        title="Settings"
        description="Operating identity, the human-approval gate, rate limits, integrations, and compliance. Everything Aria runs against lives here."
        actions={
          canResetSyntheticDemo ? (
            <Button
              variant="outline"
              size="md"
              leftIcon={<RotateCcw className="h-4 w-4" />}
              onClick={handleReset}
            >
              Reset synthetic demo
            </Button>
          ) : null
        }
      />

      <HydrationGate
        hydrated={hydrated}
        fallback={
          <div className="space-y-6">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        }
      >
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          {/* Tab rail — jump straight to a section, no scrolling */}
          <div className="lg:sticky lg:top-4 lg:self-start lg:border-r lg:border-line lg:pr-5">
            <div
              role="tablist"
              aria-label="Settings sections"
              aria-orientation="vertical"
              className="flex gap-1.5 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0 lg:snap-none"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`settings-tab-${t.id}`}
                  aria-selected={activeTab === t.id}
                  aria-controls="settings-panel"
                  onClick={() => goTab(t.id)}
                  className={cn(
                    "inline-flex shrink-0 snap-start items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-150 lg:w-full",
                    activeTab === t.id
                      ? "bg-gradient-to-r from-electric/90 to-violet/80 text-white shadow-glow-purple"
                      : "text-ink-soft hover:bg-violet/10 hover:text-ink",
                  )}
                >
                  {t.icon}
                  <span className="whitespace-nowrap">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <SettingsTabContext.Provider value={activeTab}>
            <SettingsAccordionContext.Provider
              value={{ openSection, setOpenSection, focusSectionHeader }}
            >
            <div
              className="min-w-0"
              id="settings-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeTab}`}
              tabIndex={0}
            >
          {/* 01 — System identity */}
          <Section
            n="01"
            eyebrow="Identity"
            title="System identity"
            description="How Aria signs its work and who it acts on behalf of."
          >
            <Card>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Operator name"
                  htmlFor="operatorName"
                  hint="Named on approvals and audit-log entries."
                >
                  <Input
                    id="operatorName"
                    value={settings.operatorName}
                    onChange={(e) => actions.updateSettings({ operatorName: e.target.value })}
                    onBlur={savedToast}
                    placeholder="e.g. Talent Operations"
                  />
                </Field>
                <Field
                  label="System identity"
                  htmlFor="systemIdentity"
                  hint="The persona Aria presents as in drafted outreach."
                >
                  <Input
                    id="systemIdentity"
                    value={settings.systemIdentity}
                    onChange={(e) => actions.updateSettings({ systemIdentity: e.target.value })}
                    onBlur={savedToast}
                    placeholder="e.g. Aria Sourcing Assistant"
                  />
                </Field>
              </CardContent>
            </Card>
          </Section>

          {/* 02 — Autonomy & approval */}
          <Section
            n="02"
            eyebrow="Autonomy"
            title="Approval gate"
            description="The guardrails between machine speed and a real send. Dry-run keeps everything safe."
          >
            <Card>
              <CardContent className="space-y-5">
                <div className="divide-y divide-line rounded-2xl border border-line">
                  <div className="flex items-center justify-between gap-4 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <div>
                        <p className="text-sm font-semibold text-ink">Human approval required</p>
                        <p className="mt-1 text-xs text-muted">
                          Every generated message stays in human review until a named operator approves its exact content and recipient.
                        </p>
                      </div>
                    </div>
                    <Badge tone="success" size="sm">Always on</Badge>
                  </div>
                  <ToggleRow
                    id="dryRunMode"
                    icon={<Lock className="h-4 w-4" />}
                    label="Dry-run mode"
                    description="Simulate sends only: nothing leaves the system. The safe default for this build."
                    checked={settings.dryRunMode}
                    onCheckedChange={(v) => setToggle({ dryRunMode: v }, "Dry-run mode", v)}
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Minimum score to contact"
                    htmlFor="minScoreToContact"
                    hint="Candidates below this match score are never contacted (0–100)."
                  >
                    <Input
                      id="minScoreToContact"
                      type="number"
                      min={0}
                      max={100}
                      value={settings.minScoreToContact}
                      onChange={(e) =>
                        actions.updateSettings({
                          minScoreToContact: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      onBlur={savedToast}
                    />
                  </Field>
                  <Field
                    label="Reply SLA (minutes)"
                    htmlFor="slaMinutes"
                    hint="Target window to respond to a hot reply before it is flagged overdue."
                  >
                    <Input
                      id="slaMinutes"
                      type="number"
                      min={1}
                      value={settings.slaMinutes}
                      onChange={(e) =>
                        actions.updateSettings({
                          slaMinutes: Math.max(1, Number(e.target.value) || 0),
                        })
                      }
                      onBlur={savedToast}
                    />
                  </Field>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* 03 — Rate limits */}
          <Section
            n="03"
            eyebrow="Throughput"
            title="Rate limits"
            description="Daily ceilings and cool-downs that keep outreach human-paced and deliverable."
          >
            <Card>
              <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label="Emails / day"
                  htmlFor="emailsPerDay"
                  hint="Per-day email cap."
                >
                  <Input
                    id="emailsPerDay"
                    type="number"
                    min={0}
                    value={settings.rateLimits.emailsPerDay}
                    onChange={(e) => patchRate("emailsPerDay", Math.max(0, Number(e.target.value) || 0))}
                    onBlur={savedToast}
                  />
                </Field>
                <Field
                  label="LinkedIn / day"
                  htmlFor="linkedinPerDay"
                  hint="Per-day LinkedIn cap."
                >
                  <Input
                    id="linkedinPerDay"
                    type="number"
                    min={0}
                    value={settings.rateLimits.linkedinPerDay}
                    onChange={(e) =>
                      patchRate("linkedinPerDay", Math.max(0, Number(e.target.value) || 0))
                    }
                    onBlur={savedToast}
                  />
                </Field>
                <Field
                  label="Follow-up gap (days)"
                  htmlFor="followUpGapDays"
                  hint="Wait before a follow-up."
                >
                  <Input
                    id="followUpGapDays"
                    type="number"
                    min={0}
                    value={settings.rateLimits.followUpGapDays}
                    onChange={(e) =>
                      patchRate("followUpGapDays", Math.max(0, Number(e.target.value) || 0))
                    }
                    onBlur={savedToast}
                  />
                </Field>
                <Field
                  label="Suppression (days)"
                  htmlFor="suppressionDays"
                  hint="Cool-down after a no."
                >
                  <Input
                    id="suppressionDays"
                    type="number"
                    min={0}
                    value={settings.rateLimits.suppressionDays}
                    onChange={(e) =>
                      patchRate("suppressionDays", Math.max(0, Number(e.target.value) || 0))
                    }
                    onBlur={savedToast}
                  />
                </Field>
              </CardContent>
            </Card>
          </Section>

          {/* 04 — Integrations */}
          <Section
            n="04"
            eyebrow="Connections"
            title="Integrations"
            description="The inbox, sourcing, enrichment, calendar, and comms tools Aria orchestrates."
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success" size="sm" dot>
                {summary.connected} connected
              </Badge>
              {summary.degraded > 0 && (
                <Badge tone="warning" size="sm" dot>
                  {summary.degraded} degraded
                </Badge>
              )}
              {summary.error > 0 && (
                <Badge tone="danger" size="sm" dot>
                  {summary.error} error
                </Badge>
              )}
              {summary.notConfigured > 0 && (
                <Badge tone="neutral" size="sm" dot>
                  {summary.notConfigured} not configured
                </Badge>
              )}
              <span className="text-xs text-muted">of {summary.total} total · mock is the safe default</span>
            </div>

            {integrations.length === 0 ? (
              <EmptyState
                icon={<Plug2 className="h-7 w-7" />}
                title="No integrations configured"
                description="Integrations appear here once Aria is provisioned with its tool connections."
              />
            ) : (
              <>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {integrations.map((i) => (
                    <IntegrationCard key={i.id} integration={i} />
                  ))}
                </div>
                <DatabricksPanel />
              </>
            )}
          </Section>

          {/* 05 — Compliance */}
          <Section
            n="05"
            eyebrow="Governance"
            title="Compliance"
            description="GDPR & CCPA controls, unsubscribe enforcement, and how long each record is retained."
          >
            <CompliancePanel />
          </Section>

          {/* 06 — Notifications */}
          <Section
            n="06"
            eyebrow="Alerts"
            title="Notifications"
            description="Where Aria pings you when something needs a human: approvals, hot replies, escalations."
          >
            <Card>
              <CardContent>
                <div className="divide-y divide-line rounded-2xl border border-line">
                  <ToggleRow
                    id="notify-slack"
                    icon={<Slack className="h-4 w-4" />}
                    label="Slack"
                    description="Post approvals and hot replies to your Slack workspace."
                    checked={settings.notifications.slack}
                    onCheckedChange={(v) => patchNotify("slack", v)}
                  />
                  <ToggleRow
                    id="notify-telegram"
                    icon={<Send className="h-4 w-4" />}
                    label="Telegram"
                    description="Send urgent escalations to your Telegram channel."
                    checked={settings.notifications.telegram}
                    onCheckedChange={(v) => patchNotify("telegram", v)}
                  />
                  <ToggleRow
                    id="notify-email"
                    icon={<Mail className="h-4 w-4" />}
                    label="Email"
                    description="Daily digest and immediate alerts to the operator inbox."
                    checked={settings.notifications.email}
                    onCheckedChange={(v) => patchNotify("email", v)}
                  />
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Toggling on records your preference. Delivery begins once you add the matching
                  Slack/Telegram webhook or SMTP credential in Access &amp; Keys.
                </p>
              </CardContent>
            </Card>
          </Section>

          {/* 07 — Confidentiality */}
          <Section
            n="07"
            eyebrow="Privacy"
            title="Confidentiality"
            description="Purpose-limit candidate PII to active outreach. Reveals are written to the audit trail."
          >
            <Card>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-line">
                  <ToggleRow
                    id="confidentialityMode"
                    icon={<EyeOff className="h-4 w-4" />}
                    label="Confidentiality mode"
                    description="Mask names and contact details everywhere except an active outreach context. Operators can reveal PII, but every reveal is logged."
                    checked={settings.confidentialityMode}
                    onCheckedChange={(v) =>
                      setToggle({ confidentialityMode: v }, "Confidentiality mode", v)
                    }
                  />
                </div>
                <p className="text-xs text-muted">
                  Purpose limitation: contact data is only fully visible when there is a
                  legitimate outreach purpose for that candidate. Anywhere else (lists, search,
                  the pipeline), email and name are minimized. Tap{" "}
                  <span className="font-medium text-ink-soft">Reveal contact</span> on a profile
                  to unmask, and that access is recorded against the operator.
                </p>
              </CardContent>
            </Card>
          </Section>

          {/* 08 — Humanizer */}
          <Section
            n="08"
            eyebrow="Voice"
            title="Humanizer"
            description="An always-on pass that strips AI tells from every generated message before a human ever sees it."
          >
            <Card>
              <CardContent className="space-y-5">
                <div className="rounded-2xl border border-line">
                  <ToggleRow
                    id="humanizer-enforced"
                    icon={<Sparkles className="h-4 w-4" />}
                    label="Enforced on every draft"
                    description="Runs on outreach, reply drafts, and clarification emails. This guardrail can't be turned off."
                    checked
                    disabled
                    onCheckedChange={() => {
                      /* always on — no-op */
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="success" size="sm" dot>
                    Always on
                  </Badge>
                  <span className="text-xs text-muted">Deterministic, so output stays stable and reviewable.</span>
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    A few of the tells it strips
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BANNED_AI_ISMS.map((word) => (
                      <Badge key={word} tone="neutral" size="sm">
                        {word}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* 09 — Fleet guardrails */}
          <Section
            n="09"
            eyebrow="Fleet"
            title="Fleet guardrails"
            description="The shared rules every sending agent obeys: re-contact windows, auto-pause thresholds, and human pacing."
          >
            <Card>
              <CardContent className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field
                    label="Re-contact window (days)"
                    htmlFor="recontactWindowDays"
                    hint="Global cool-down before any agent may contact the same person again."
                  >
                    <Input
                      id="recontactWindowDays"
                      type="number"
                      min={0}
                      value={settings.fleet.recontactWindowDays}
                      onChange={(e) =>
                        patchFleet({ recontactWindowDays: Math.max(0, Number(e.target.value) || 0) })
                      }
                      onBlur={savedToast}
                    />
                  </Field>
                  <Field
                    label="Bounce auto-pause (%)"
                    htmlFor="bounceRatePauseThreshold"
                    hint="Pause a seat once its bounce rate rises above this."
                  >
                    <Input
                      id="bounceRatePauseThreshold"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={bouncePct}
                      onChange={(e) =>
                        patchFleet({
                          bounceRatePauseThreshold:
                            Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                        })
                      }
                      onBlur={savedToast}
                    />
                  </Field>
                  <Field
                    label="Complaint auto-pause (%)"
                    htmlFor="complaintRatePauseThreshold"
                    hint="Pause a seat once its spam-complaint rate rises above this."
                  >
                    <Input
                      id="complaintRatePauseThreshold"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={complaintPct}
                      onChange={(e) =>
                        patchFleet({
                          complaintRatePauseThreshold:
                            Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                        })
                      }
                      onBlur={savedToast}
                    />
                  </Field>
                </div>

                <div className="divide-y divide-line rounded-2xl border border-line">
                  <ToggleRow
                    id="enforceBusinessHours"
                    icon={<Clock className="h-4 w-4" />}
                    label="Enforce business hours"
                    description="Only send inside each seat's configured send window, never overnight or on off-days."
                    checked={settings.fleet.enforceBusinessHours}
                    onCheckedChange={(v) =>
                      toggleFleet("enforceBusinessHours", "Business-hours enforcement", v)
                    }
                  />
                  <ToggleRow
                    id="jitter"
                    icon={<Shuffle className="h-4 w-4" />}
                    label="Human-paced jitter"
                    description="Randomize the gap between sends so cadence looks natural, not machine-timed."
                    checked={settings.fleet.jitter}
                    onCheckedChange={(v) => toggleFleet("jitter", "Send jitter", v)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 rounded-2xl bg-ink/[0.03] p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-soft" aria-hidden>
                      <Users className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">Agent fleet</p>
                      <p className="mt-0.5 text-xs text-muted">
                        Add seats, connect official mailboxes, and manage warm-up per agent.
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/fleet"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-tangerine px-3.5 text-sm font-semibold text-white shadow-soft transition-all duration-150 hover:bg-tangerine/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                  >
                    Manage agents
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* 10 — Scale & localization */}
          <Section
            n="10"
            eyebrow="Scale"
            title="Scale & localization"
            description="Run an army of coordinated agents and reach candidates in any language: multi-user, multi-mailbox, one set of rules."
          >
            <Card>
              <CardContent className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    label="Outreach language (default)"
                    htmlFor="defaultLanguage"
                    hint="Aria composes in this language; per-need detection and per-agent language override it."
                  >
                    <Select
                      id="defaultLanguage"
                      value={settings.defaultLanguage}
                      onChange={(e) => {
                        actions.updateSettings({ defaultLanguage: e.target.value });
                        savedToast();
                      }}
                      options={LANGUAGES.map((l) => ({ value: l.code, label: `${l.label} (${l.native})` }))}
                    />
                  </Field>
                  <Field
                    label="Max agents (fleet ceiling)"
                    htmlFor="maxAgents"
                    hint="Hard cap on deployable agents across the workspace."
                  >
                    <Input
                      id="maxAgents"
                      type="number"
                      min={1}
                      max={1000}
                      value={settings.fleet.maxAgents}
                      onChange={(e) => patchFleet({ maxAgents: Math.max(1, Number(e.target.value) || 1) })}
                      onBlur={savedToast}
                    />
                  </Field>
                </div>

                <div className="rounded-2xl bg-ink/[0.03] p-4 text-sm text-muted">
                  Multiple operators can run the same workspace: every signed-in teammate shares one
                  campaign pipeline, one suppression ledger, and one de-dupe guarantee, so a large
                  fleet never double-contacts a candidate. Each agent is a real, authorized mailbox
                  within its provider's official limits. Scale, not rate-limit evasion.
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/fleet"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-ink/25"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">Deploy agents</span>
                      <span className="block text-xs text-muted">Spin up coordinated sourcing + outreach agents.</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                  <Link
                    href="/skills"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-ink/25"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">Learning skills</span>
                      <span className="block text-xs text-muted">The playbooks the agents learn and run.</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </div>
              </CardContent>
            </Card>
          </Section>

          {/* 11 — API keys */}
          <Section
            n="11"
            eyebrow="Secrets"
            title="API keys"
            description="Add a provider key and test it. Secrets are stored server-side and never shown again (admins only)."
          >
            <ApiKeysPanel />
          </Section>

          {/* 12 — Access & roles */}
          <Section
            n="12"
            eyebrow="Access"
            title="Access & roles"
            description="Admin, member and viewer. Roles gate who can manage settings, keys, the fleet, and who is read-only."
          >
            <RolesPanel />
          </Section>

          {/* 13 — Guardrails & Aria */}
          <Section
            n="13"
            eyebrow="Guardrails"
            title="Guardrails & Aria"
            description="The adjustable brain. Edit Aria's master prompt, manage the rules every agent follows, or just ask Aria. No .env, no code."
          >
            <GuardrailsPanel />
          </Section>

          {/* 14 — LLM providers */}
          <Section
            n="14"
            eyebrow="AI backbone"
            title="LLM providers"
            description="Connect the language model backends the sourcing fleet runs on. Each provider links to a saved API key (secrets never leave the server). Admin only."
          >
            <ProvidersPanel />
          </Section>

          {/* 15 — Models */}
          <Section
            n="15"
            eyebrow="Models"
            title="Saved models"
            description="Register the specific models your fleet uses and set which model handles each task type: sourcing, outreach, classification, and chat. Admin only."
          >
            <ModelsPanel />
          </Section>

          {/* 16 — Tools */}
          <Section
            n="16"
            eyebrow="Capabilities"
            title="Tools"
            description="Toggle the capabilities available to every agent by default. Individual agents can be assigned a custom tool subset from the fleet page. Admin only."
          >
            <ToolsPanel />
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="text-sm font-semibold text-ink">MCP tool servers</h3>
              <p className="mb-3 mt-1 text-xs text-muted">
                Connect external Model Context Protocol servers (sourcing, enrichment, messaging, and
                more) to give the fleet more tools. The auth token is stored server-side in the key vault.
              </p>
              <McpServersPanel />
            </div>
          </Section>

          {/* 17 — Aria runtime */}
          <Section
            n="17"
            eyebrow="Runtime"
            title="Aria agent runtime"
            description="Connect the live NousResearch Aria agent for real LLM-backed outreach drafting. Text generation only. The approval gate still applies. Falls back to the built-in mock when off or misconfigured. Admin only."
          >
            <HermesRuntimePanel />
          </Section>

          {/* 19 — Dust agent platform */}
          <Section
            n="19"
            eyebrow="Agent platform"
            title="Dust agents"
            description="Connect a Dust (dust.tt) workspace and lock which of your own agents runs each recruiting task, starting with JD analysis on intake. Admin only."
          >
            <DustAgentPanel />
          </Section>

          {/* 18 — Schedules */}
          <Section
            n="18"
            eyebrow="Automation"
            title="Schedules"
            description="Recurring fleet jobs: sourcing sweeps, outreach batches, and reports on a cadence. Each run still passes through the approval gate. Admin only."
          >
            <SchedulesPanel />
            <div className="mt-6">
              <HermesSchedulesPanel />
            </div>
          </Section>
            </div>
            </SettingsAccordionContext.Provider>
          </SettingsTabContext.Provider>
        </div>
      </HydrationGate>
    </div>
  );
}
