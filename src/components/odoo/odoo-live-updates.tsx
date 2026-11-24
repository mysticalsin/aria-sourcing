"use client";

import * as React from "react";
import { Copy, Radio, Unplug } from "lucide-react";
import { Badge, Button, Field, Input, useConfirm, useToast } from "@/components/ui";
import { copyToClipboard, formatTimeAgo } from "@/lib/utils";
import { jsonBody, odooApi, type OdooConnectionView } from "./api";

type PushAnswer = {
  url: string;
  automated: boolean;
  reason?: string;
  steps?: string[];
  connection: OdooConnectionView;
};

/**
 * Settings > Odoo > Live updates (admin). Odoo calls ARIA when a handed-off
 * applicant changes stage. ARIA creates the Odoo automation rule itself when
 * its Odoo user may; otherwise IT follows the steps shown, once.
 */
export function OdooLiveUpdates({
  connection,
  onConnection,
}: {
  connection: OdooConnectionView;
  onConnection: (next: OdooConnectionView) => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const push = connection.push;
  const [ariaUrl, setAriaUrl] = React.useState(push?.ariaUrl ?? "");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PushAnswer | null>(null);

  React.useEffect(() => {
    if (!ariaUrl && typeof window !== "undefined") setAriaUrl(push?.ariaUrl ?? window.location.origin);
  }, [ariaUrl, push?.ariaUrl]);

  async function setUp() {
    setBusy(true);
    const res = await odooApi<PushAnswer>("/push", jsonBody("POST", { ariaUrl }));
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Live updates not set up", description: res.error, variant: "error" });
      return;
    }
    setResult(res.data);
    onConnection(res.data.connection);
    toast({
      title: res.data.automated ? "Live updates on" : "One step left in Odoo",
      description: res.data.automated ? "ARIA created the automation rule in Odoo." : (res.data.reason ?? "Create the automation rule in Odoo."),
      variant: res.data.automated ? "success" : "warning",
    });
  }

  async function turnOff() {
    const ok = await confirm({
      title: "Turn live updates off?",
      description: "Odoo stops calling ARIA. Stages still come back when someone opens the campaign.",
      confirmLabel: "Turn off",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    const res = await odooApi<{ removedInOdoo: boolean; connection: OdooConnectionView }>("/push", { method: "DELETE" });
    if (!res.ok) {
      toast({ title: "Live updates not turned off", description: res.error, variant: "error" });
      return;
    }
    setResult(null);
    onConnection(res.data.connection);
    toast({
      title: "Live updates off",
      description: res.data.removedInOdoo || !push?.inOdoo ? undefined : "Delete the rule \"ARIA: applicant changed\" in Odoo (ARIA could not).",
      variant: "info",
    });
  }

  async function copy(url: string) {
    const ok = await copyToClipboard(url);
    toast({ title: ok ? "Address copied" : "Copy failed", variant: ok ? "success" : "error" });
  }

  return (
    <div className="space-y-3 border-t border-line pt-4" data-odoo-live-updates>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Live updates from Odoo</p>
        {push?.enabled ? (
          <Badge tone="success" size="sm" dot>
            on{push.inOdoo ? " · rule created by ARIA" : ""}
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm">
            off
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted">
        Odoo tells ARIA when a candidate ARIA sent moves to another stage, is refused or hired: ARIA updates the candidate
        at once, and pages already open follow within about 15 seconds. Without it, stages come back when someone opens
        the campaign. Odoo must be able to reach ARIA, and needs its Automation Rules app.
        {push?.enabled && push.lastCallAt ? ` Last call from Odoo ${formatTimeAgo(push.lastCallAt)}.` : push?.enabled ? " No call from Odoo yet." : ""}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="ARIA address, as Odoo reaches it" htmlFor="odoo-aria-url" hint="https:// in production.">
          <Input id="odoo-aria-url" value={ariaUrl} onChange={(e) => setAriaUrl(e.target.value)} placeholder="https://aria.example.com" />
        </Field>
        <Button variant="outline" size="sm" loading={busy} leftIcon={<Radio className="h-4 w-4" />} onClick={() => void setUp()}>
          {push?.enabled ? "New address" : "Set up live updates"}
        </Button>
        {push?.enabled && (
          <Button variant="ghost" size="sm" leftIcon={<Unplug className="h-4 w-4" />} onClick={() => void turnOff()}>
            Turn off
          </Button>
        )}
      </div>
      {result && (
        <div className="space-y-2 rounded-2xl border border-line bg-ink/[0.03] p-3.5 text-sm" data-odoo-push-result>
          <p className="font-semibold text-ink">
            {result.automated ? "Done: Odoo now calls this address." : `Create the rule in Odoo: ${result.reason ?? ""}`}
          </p>
          {!result.automated && result.steps && (
            <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2 py-1 font-mono text-xs text-ink">{result.url}</code>
            <Button variant="subtle" size="sm" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void copy(result.url)}>
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted">This address contains a secret and is shown once. Setting up again replaces it.</p>
        </div>
      )}
    </div>
  );
}
