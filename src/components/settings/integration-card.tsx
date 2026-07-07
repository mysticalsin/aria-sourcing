"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  Card,
  CardContent,
  Eyebrow,
  Badge,
  Button,
  Modal,
  Switch,
  Input,
  Field,
  useToast,
} from "@/components/ui";
import { useActions } from "@/lib/store";
import type { IntegrationStatus } from "@/lib/types";
import { toneForHealth, formatTimeAgo, cn } from "@/lib/utils";
import {
  Inbox,
  Search,
  Sparkles,
  Database,
  Calendar,
  MessageSquare,
  Server,
  Plug,
  Activity,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Wrench,
} from "lucide-react";

const CATEGORY_ICON: Record<IntegrationStatus["category"], React.ReactNode> = {
  Inbox: <Inbox className="h-5 w-5" />,
  Sourcing: <Search className="h-5 w-5" />,
  Enrichment: <Sparkles className="h-5 w-5" />,
  CRM: <Database className="h-5 w-5" />,
  Calendar: <Calendar className="h-5 w-5" />,
  Comms: <MessageSquare className="h-5 w-5" />,
  Infra: <Server className="h-5 w-5" />,
};

const HEALTH_LABEL: Record<IntegrationStatus["status"], string> = {
  connected: "Connected",
  degraded: "Degraded",
  error: "Error",
  not_configured: "Not configured",
};

export function IntegrationCard({ integration }: { integration: IntegrationStatus }) {
  const actions = useActions();
  const router = useRouter();
  const { toast } = useToast();
  const [configureOpen, setConfigureOpen] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [smtpOpen, setSmtpOpen] = React.useState(false);
  const [smtpEmail, setSmtpEmail] = React.useState("");
  const [smtpPassword, setSmtpPassword] = React.useState("");
  const [smtpHost, setSmtpHost] = React.useState("");

  // Stable IDs for accessible label–input pairing (WCAG 1.3.1)
  const smtpEmailId = React.useId();
  const smtpPasswordId = React.useId();
  const smtpHostId = React.useId();
  const apiKeyId = React.useId();
  const accountId = React.useId();

  const isLive = integration.mode === "live";
  const connected = integration.status === "connected";
  const isMailbox = integration.category === "Inbox" || integration.category === "Comms";

  function handleCloseModal() {
    setConfigureOpen(false);
    setSmtpOpen(false);
    setSmtpEmail("");
    setSmtpPassword("");
    setSmtpHost("");
  }

  async function handleTest() {
    setTesting(true);
    const result = await actions.testIntegration(integration.id);
    setTesting(false);
    toast({
      title: result.ok ? `${integration.name} ready` : `${integration.name} not ready`,
      description: result.latencyMs > 0 ? `${result.message} · ${result.latencyMs}ms` : result.message,
      variant: result.ok ? "success" : "error",
    });
  }

  function handleToggleMode() {
    const nextMode = isLive ? "mock" : "live";
    actions.toggleIntegrationMode(integration.id);
    toast({
      title: `${integration.name} → ${nextMode === "live" ? "Live" : "Mock"} mode`,
      description:
        nextMode === "live"
          ? "Live mode active: outreach routes through these credentials once the sending domain is verified."
          : "Mock mode is the safe default. No real calls are made.",
      variant: nextMode === "live" ? "warning" : "info",
    });
  }

  async function handleConnect() {
    if (!apiKey.trim()) {
      toast({ title: "Credentials required", description: "Enter an API key or token to connect.", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await actions.saveApiKey({ name: `${integration.name} connection`, provider: "Custom", value: apiKey.trim() });
      actions.updateIntegration(integration.id, {
        status: "connected",
        connectedAccount: account.trim() || undefined,
        lastSync: new Date().toISOString(),
        errors: [],
      });
      toast({
        title: `${integration.name} connected`,
        description: "Credentials stored server-side. Flip Live mode on the card when you're ready.",
        variant: "success",
      });
      setApiKey("");
      setAccount("");
      handleCloseModal();
    } catch {
      toast({ title: "Couldn't connect", description: "Saving the credential failed. Try again.", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSmtpConnect() {
    if (!smtpEmail.trim() || !smtpPassword.trim() || !smtpHost.trim()) {
      toast({ title: "All fields required", description: "Enter your email address, app password, and SMTP host.", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await actions.saveApiKey({
        name: `${integration.name} (${smtpEmail.trim()})`,
        provider: "Custom",
        value: `smtp:${JSON.stringify({ host: smtpHost.trim(), email: smtpEmail.trim(), password: smtpPassword.trim() })}`,
      });
      actions.updateIntegration(integration.id, {
        status: "connected",
        connectedAccount: smtpEmail.trim(),
        lastSync: new Date().toISOString(),
        errors: [],
      });
      toast({
        title: `${integration.name} connected`,
        description: `Linked ${smtpEmail.trim()} via SMTP / IMAP. Flip Live mode when ready.`,
        variant: "success",
      });
      handleCloseModal();
    } catch {
      toast({ title: "Couldn't connect", description: "Saving the credential failed. Try again.", variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleDisconnect() {
    actions.updateIntegration(integration.id, {
      status: "not_configured",
      lastSync: null,
      mode: "mock",
      errors: [],
      connectedAccount: "",
    });
    toast({ title: `${integration.name} disconnected`, description: "Reverted to mock mode.", variant: "info" });
    handleCloseModal();
  }

  const tone = toneForHealth(integration.status);

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                tone === "success" && "bg-success-soft text-success",
                tone === "warning" && "bg-warning-soft text-warning",
                tone === "danger" && "bg-danger-soft text-danger",
                tone === "neutral" && "bg-ink/[0.06] text-ink-soft",
              )}
              aria-hidden
            >
              {CATEGORY_ICON[integration.category]}
            </div>
            <div className="min-w-0 flex-1">
              <Eyebrow>{integration.category}</Eyebrow>
              <h3 className="truncate text-base font-bold text-ink">{integration.name}</h3>
            </div>
            {integration.real ? (
              <Badge tone={isLive ? "tangerine" : "aqua"} size="sm">
                {isLive ? "Live" : "Mock"}
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                Concept
              </Badge>
            )}
          </div>

          <p className="text-sm leading-relaxed text-ink-soft">{integration.description}</p>

          {integration.connectedAccount && (
            <div className="-mt-1 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              <span className="truncate text-xs font-medium text-success">
                {integration.connectedAccount}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone} dot>
              {HEALTH_LABEL[integration.status]}
            </Badge>
            <span className="text-xs text-muted">
              {integration.lastSync
                ? `Synced ${formatTimeAgo(integration.lastSync)}`
                : "Never synced"}
            </span>
          </div>

          {integration.errors.length > 0 && (
            <div className="rounded-2xl bg-danger-soft px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {integration.errors.length === 1 ? "Issue" : "Issues"}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-danger/90">
                {integration.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-auto space-y-3 pt-1">
            {integration.real && (
              <div className="flex items-center justify-between rounded-2xl bg-canvas px-3 py-2.5">
                <div>
                  <label htmlFor={`mode-${integration.id}`} className="text-sm font-semibold text-ink">
                    Live mode
                  </label>
                  <p className="text-xs text-muted">
                    {isLive ? "Real credentials path" : "Mock is the safe default"}
                  </p>
                </div>
                <Switch
                  id={`mode-${integration.id}`}
                  checked={isLive}
                  onCheckedChange={handleToggleMode}
                  label={`Toggle ${integration.name} live mode`}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                leftIcon={<Plug className="h-4 w-4" />}
                onClick={() => setConfigureOpen(true)}
              >
                Configure
              </Button>
              {/* Only GitHub has a real, live connection check (testIntegration in
                  store.ts pings /api/source). Other real cards point to their actual
                  setup surface instead of running the no-op mock testConnection(). */}
              {integration.real && integration.id === "int_github" && (
                <Button
                  variant="subtle"
                  size="sm"
                  className="flex-1"
                  loading={testing}
                  leftIcon={<Activity className="h-4 w-4" />}
                  onClick={handleTest}
                >
                  Test connection
                </Button>
              )}
              {integration.real && integration.id !== "int_github" && integration.setupHref && (
                <Button
                  variant="subtle"
                  size="sm"
                  className="flex-1"
                  leftIcon={<Wrench className="h-4 w-4" />}
                  onClick={() => router.push(integration.setupHref!)}
                >
                  Setup guide
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={configureOpen}
        onClose={handleCloseModal}
        title={`Connect ${integration.name}`}
        description="Add your credentials right here. No code, no .env editing."
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {connected ? (
              <Button variant="subtle" size="sm" onClick={handleDisconnect}>
                Disconnect
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="subtle" size="sm" onClick={handleCloseModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                leftIcon={<Plug className="h-4 w-4" />}
                onClick={handleConnect}
              >
                {connected ? "Update connection" : "Connect"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {connected && (
            <div className="flex items-start gap-2.5 rounded-2xl bg-success-soft px-3.5 py-3 text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                {integration.connectedAccount && (
                  <p className="truncate text-sm font-semibold">{integration.connectedAccount}</p>
                )}
                <p className="text-sm">
                  Connected{integration.lastSync ? ` · last synced ${formatTimeAgo(integration.lastSync)}` : ""}.
                  {" "}Update the credential below, or disconnect.
                </p>
              </div>
            </div>
          )}

          {/* Mailbox account-connect block — shown for Inbox / Comms integrations */}
          {isMailbox && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Connect your account
              </p>

              {!smtpOpen && (
                <div className="space-y-2.5">
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Each agent connects its own Gmail or Outlook mailbox with real sign-in.{" "}
                    <Link
                      href="/fleet"
                      className="font-medium text-ink underline underline-offset-2 hover:text-ink/70"
                    >
                      Connect a mailbox in Agent Fleet
                    </Link>
                  </p>
                  <button
                    type="button"
                    onClick={() => setSmtpOpen(true)}
                    className="flex items-center gap-2.5 rounded-2xl border border-ink/[0.1] bg-surface px-3.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
                  >
                    <Server className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
                    Connect via SMTP / IMAP
                  </button>
                </div>
              )}

              {smtpOpen && (
                <div className="space-y-3 rounded-2xl border border-ink/[0.1] bg-canvas p-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setSmtpOpen(false); setSmtpEmail(""); setSmtpPassword(""); setSmtpHost(""); }}
                      className="text-ink-soft transition-colors hover:text-ink"
                      aria-label="Back"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                    </button>
                    <p className="text-sm font-semibold text-ink">SMTP / IMAP settings</p>
                  </div>
                  <Field label="Email address" htmlFor={smtpEmailId}>
                    <Input
                      id={smtpEmailId}
                      type="email"
                      value={smtpEmail}
                      onChange={(e) => setSmtpEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                    />
                  </Field>
                  <Field label="App password" htmlFor={smtpPasswordId} hint="Use an app-specific password, not your account password.">
                    <Input
                      id={smtpPasswordId}
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder="App-specific password"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="SMTP host" htmlFor={smtpHostId}>
                    <Input
                      id={smtpHostId}
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                    />
                  </Field>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    loading={saving}
                    onClick={handleSmtpConnect}
                  >
                    Connect
                  </Button>
                </div>
              )}

              {!smtpOpen && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-ink/[0.08]" />
                  <span className="text-xs text-muted">or use API key</span>
                  <div className="h-px flex-1 bg-ink/[0.08]" />
                </div>
              )}
            </div>
          )}

          <Field
            label={`${integration.name} API key`}
            htmlFor={apiKeyId}
            hint="Stored encrypted server-side (never returned to the browser)."
          >
            <Input
              id={apiKeyId}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key or access token"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Account or endpoint (optional)"
            htmlFor={accountId}
            hint="The mailbox, workspace, or base URL the provider uses, if any."
          >
            <Input
              id={accountId}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={isMailbox ? "name@company.com" : "https://api.provider.com"}
            />
          </Field>

          <div className="flex items-start gap-2.5 rounded-2xl bg-aqua-soft px-3.5 py-3 text-aqua">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-xs">
              After connecting, flip <strong>Live mode</strong> on the card and hit{" "}
              <strong>Test connection</strong>. This build stays dry-run. Nothing real (outreach,
              money, candidate data) leaves until you go live.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
