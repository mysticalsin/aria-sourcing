"use client";

import * as React from "react";
import { CheckCircle2, Link2, RefreshCw, Save, Unlink } from "lucide-react";
import { Badge, Button, Card, CardContent, Field, Input, Select, useConfirm, useToast } from "@/components/ui";
import {
  jsonBody,
  odooApi,
  type OdooConnectionView,
  type OdooStageView,
  type StageTarget,
} from "@/components/odoo/api";
import { OdooErasures } from "@/components/odoo/odoo-erasures";
import { OdooLiveUpdates } from "@/components/odoo/odoo-live-updates";
import { useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { formatTimeAgo } from "@/lib/utils";

const TARGET_LABEL: Record<StageTarget, string> = {
  Sourced: "Sourced",
  Contacted: "Contacted",
  Replied: "Replied",
  Interested: "Interested",
  Booked: "Booked",
  Interviewed: "Interviewed",
  Offer: "Offer",
  Hired: "Hired",
  "Not Interested": "Not interested",
  Rejected: "Rejected",
  Suppressed: "Suppressed",
  ignore: "No change in ARIA",
};
const TARGET_CHOICES: StageTarget[] = ["Interested", "Booked", "Interviewed", "Offer", "Hired", "ignore"];

type ConfigAnswer = { connection: OdooConnectionView; httpAllowed?: boolean; stages?: OdooStageView[] };
type CheckAnswer = { version: string; userName: string; recruitment: boolean; stages: OdooStageView[] };

/**
 * Settings > Odoo. Odoo Recruitment is the system of record for applications
 * (ADR 0003): an admin connects the instance with an API key of a technical
 * Odoo user, and decides which ARIA stage each Odoo stage moves a handed-off
 * candidate to. The API key never comes back to the browser.
 */
export function OdooPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_settings");
  const { toast } = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = React.useState(true);
  const [connection, setConnection] = React.useState<OdooConnectionView>({ configured: false });
  const [httpAllowed, setHttpAllowed] = React.useState(false);
  const [stages, setStages] = React.useState<OdooStageView[] | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [mapDraft, setMapDraft] = React.useState<Record<string, StageTarget | "">>({});

  const [baseUrl, setBaseUrl] = React.useState("");
  const [publicUrl, setPublicUrl] = React.useState("");
  const [database, setDatabase] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");

  const applyConnection = React.useCallback((next: OdooConnectionView) => {
    setConnection(next);
    setBaseUrl(next.baseUrl ?? "");
    setPublicUrl(next.publicUrl && next.publicUrl !== next.baseUrl ? next.publicUrl : "");
    setDatabase(next.database ?? "");
    setMapDraft({ ...(next.stageMap ?? {}) });
  }, []);

  const runCheck = React.useCallback(async (announce: boolean) => {
    setChecking(true);
    const res = await odooApi<CheckAnswer>("/check", { method: "POST" });
    setChecking(false);
    if (res.ok) {
      setStages(res.data.stages);
      if (announce) toast({ title: "Odoo answers", description: `Odoo ${res.data.version}, signed in as ${res.data.userName}.`, variant: "success" });
    } else {
      setStages(null);
      toast({ title: "Odoo check failed", description: res.error, variant: "error" });
    }
    const config = await odooApi<ConfigAnswer>("/config");
    if (config.ok) setConnection(config.data.connection);
  }, [toast]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await odooApi<ConfigAnswer>("/config");
      if (cancelled) return;
      if (res.ok) {
        applyConnection(res.data.connection);
        setHttpAllowed(Boolean(res.data.httpAllowed));
        if (res.data.connection.configured && isAdmin) void runCheck(false);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Load once on mount; runCheck is stable enough for this one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(withStageMap: boolean) {
    const stageMap = Object.fromEntries(Object.entries(mapDraft).filter(([, target]) => target !== "")) as Record<string, StageTarget>;
    setSaving(true);
    const res = await odooApi<ConfigAnswer>(
      "/config",
      jsonBody("PUT", {
        baseUrl,
        database,
        ...(publicUrl.trim() ? { publicUrl } : {}),
        ...(apiKey.trim() ? { apiKey } : {}),
        ...(withStageMap ? { stageMap } : {}),
      }),
    );
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Odoo not saved", description: res.error, variant: "error" });
      return;
    }
    setApiKey("");
    setEditing(false);
    applyConnection(res.data.connection);
    if (res.data.stages) {
      const map = res.data.connection.stageMap ?? {};
      setStages(res.data.stages.map((stage) => ({ ...stage, target: map[String(stage.id)] ?? stage.target ?? "ignore", defaultTarget: stage.defaultTarget ?? stage.target })));
      void runCheck(false);
    }
    toast({
      title: withStageMap ? "Stage mapping saved" : "Odoo connected",
      description: withStageMap ? "The next sync uses it." : `Odoo ${res.data.connection.version ?? ""} as ${res.data.connection.userName ?? "the API user"}.`,
      variant: "success",
    });
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Odoo?",
      description: "ARIA forgets the connection and which campaigns and candidates are linked to Odoo. Nothing is deleted in Odoo.",
      confirmLabel: "Disconnect",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const res = await odooApi<ConfigAnswer>("/config", { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Odoo not disconnected", description: res.error, variant: "error" });
      return;
    }
    applyConnection({ configured: false });
    setStages(null);
    toast({ title: "Odoo disconnected", variant: "info" });
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted">Loading the Odoo connection…</p>
        </CardContent>
      </Card>
    );
  }

  const form = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Odoo address"
          htmlFor="odoo-url"
          hint={httpAllowed ? "As the ARIA server reaches it (http allowed on this server)." : "As the ARIA server reaches it. https:// only."}
        >
          <Input id="odoo-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://odoo.example.com" />
        </Field>
        <Field label="Database" htmlFor="odoo-db" hint="Odoo database name (Settings > Database in Odoo, or ask IT).">
          <Input id="odoo-db" value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="production" />
        </Field>
        <Field
          label="API key"
          htmlFor="odoo-key"
          hint={connection.configured ? `Leave empty to keep the stored key (••••${connection.keyLast4 ?? ""}).` : "Odoo > Preferences > Account security > New API key, scope rpc. Stored encrypted."}
        >
          <Input id="odoo-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste the Odoo API key" />
        </Field>
        <Field label="Address for people (optional)" htmlFor="odoo-public-url" hint="If recruiters open Odoo at another address than the server uses.">
          <Input id="odoo-public-url" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://odoo.example.com" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" loading={saving} leftIcon={<Link2 className="h-4 w-4" />} onClick={() => void save(false)}>
          {connection.configured ? "Test and save" : "Connect Odoo"}
        </Button>
        {connection.configured && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );

  if (!connection.configured) {
    return (
      <Card>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Connect the group&apos;s Odoo (version 19 or later, Recruitment app installed). Campaigns can then start
            from an Odoo job position, recruiters send the candidates they want to pursue to Odoo with one click, and
            the Odoo stage (interview, offer, hired, refused) comes back to ARIA.
          </p>
          {isAdmin ? form : <p className="text-xs text-muted">Admins only. Ask your workspace admin to connect Odoo.</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-success-soft px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Connected to Odoo {connection.version ?? ""}
            </p>
            <p className="text-xs text-success/80">
              <span className="font-mono">{connection.publicUrl}</span> · database <span className="font-mono">{connection.database}</span> · as{" "}
              {connection.userName ?? "the API user"} · key ••••{connection.keyLast4}
              {connection.lastCheckedAt ? ` · checked ${formatTimeAgo(connection.lastCheckedAt)}` : ""}
            </p>
            {connection.lastError && <p className="mt-1 text-xs text-danger">Last check: {connection.lastError}</p>}
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button variant="subtle" size="sm" loading={checking} leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void runCheck(true)}>
                Test now
              </Button>
              <Button variant="subtle" size="sm" onClick={() => setEditing((v) => !v)}>
                Edit
              </Button>
              <Button variant="subtle" size="sm" leftIcon={<Unlink className="h-4 w-4" />} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          )}
        </div>

        {isAdmin && editing && form}

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Odoo stage → ARIA stage</p>
          <p className="text-xs text-muted">
            When a handed-off candidate moves in Odoo, ARIA follows: it moves forward only, and Odoo&apos;s hired and refused
            outcomes always apply (refused by the applicant = Not interested).
          </p>
          {!isAdmin ? (
            <p className="text-xs text-muted">Admins set this mapping.</p>
          ) : stages === null ? (
            <p className="text-xs text-muted">{checking ? "Reading the stages from Odoo…" : "Test the connection to list Odoo's stages."}</p>
          ) : (
            <>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {stages.map((stage) => (
                  <li key={stage.id} className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {stage.name}
                      {stage.hiredStage && (
                        <Badge tone="success" size="sm">
                          hired stage
                        </Badge>
                      )}
                    </span>
                    <div className="w-full sm:w-64">
                      <Select
                        id={`odoo-stage-${stage.id}`}
                        aria-label={`ARIA stage for Odoo stage ${stage.name}`}
                        value={mapDraft[String(stage.id)] ?? ""}
                        onChange={(e) => setMapDraft((prev) => ({ ...prev, [String(stage.id)]: e.target.value as StageTarget | "" }))}
                        disabled={stage.hiredStage}
                        options={[
                          { value: "", label: `Default: ${TARGET_LABEL[stage.defaultTarget]}` },
                          ...TARGET_CHOICES.map((target) => ({ value: target, label: TARGET_LABEL[target] })),
                        ]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" loading={saving} leftIcon={<Save className="h-4 w-4" />} onClick={() => void save(true)}>
                Save mapping
              </Button>
            </>
          )}
        </div>

        {isAdmin && <OdooLiveUpdates connection={connection} onConnection={setConnection} />}
        {isAdmin && <OdooErasures />}
      </CardContent>
    </Card>
  );
}
