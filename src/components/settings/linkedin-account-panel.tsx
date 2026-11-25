"use client";

import * as React from "react";
import { Badge, Button, Card, CardContent, Field, Input, Switch } from "@/components/ui";
import {
  accountPrompt,
  type AccountView,
} from "@/lib/contact-chat/account-view";

/**
 * Short settings step for a HeyReach token.
 * The field is write-only: the server response never includes the token,
 * and this panel does not keep it after a save attempt.
 */
export function LinkedInAccountPanel() {
  const [account, setAccount] = React.useState<AccountView | null>(null);
  const [token, setToken] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch("/api/contacts/account", { cache: "no-store" });
    const body = (await res.json()) as { account?: AccountView };
    if (body.account) setAccount(body.account);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function saveToken() {
    const value = token;
    setToken("");
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/contacts/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "token", token: value }),
      });
      const body = (await res.json()) as { ok?: boolean; message?: string; account?: AccountView };
      if (body.account) setAccount(body.account);
      setMessage(body.ok ? "Account saved. HeyReach stays off until you turn it on." : body.message ?? "Could not save the account.");
    } catch {
      setMessage("Could not save the account. Paste the token again.");
    } finally {
      setSaving(false);
    }
  }

  async function setEnabled(on: boolean) {
    setMessage(null);
    const res = await fetch("/api/contacts/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: on ? "enable" : "disable" }),
    });
    const body = (await res.json()) as { ok?: boolean; message?: string; account?: AccountView };
    if (body.account) setAccount(body.account);
    if (!body.ok && body.message) setMessage(body.message);
  }

  const prompt = account ? accountPrompt(account) : null;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">LinkedIn account</h3>
          <Badge tone={account?.enabled ? "success" : "neutral"} size="sm">
            {account?.enabled ? "HeyReach on" : "HeyReach off"}
          </Badge>
          {account?.tokenConfigured ? (
            <Badge tone="success" size="sm">Token saved</Badge>
          ) : (
            <Badge tone="warning" size="sm">Add your account</Badge>
          )}
        </div>
        <p className="text-sm text-muted">
          Paste a HeyReach token. It stays on the server and is not shown again. The channel stays off until you turn it on.
        </p>
        {prompt?.tone === "account" && (
          <p className="text-sm font-medium text-ink">{prompt.message}</p>
        )}
        <Field label="HeyReach token" htmlFor="linkedin-account-token" hint="Write-only. LinkedIn session cookies are refused.">
          <Input
            id="linkedin-account-token"
            data-testid="linkedin-account-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="HeyReach token"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" size="sm" onClick={() => void saveToken()} disabled={saving || token.trim().length === 0}>
            {saving ? "Saving…" : "Save account"}
          </Button>
          <Switch
            id="heyreach-enabled"
            checked={account?.enabled ?? false}
            onCheckedChange={(on) => void setEnabled(on)}
            label={account?.enabled ? "HeyReach on" : "HeyReach off"}
            disabled={!account?.tokenConfigured}
          />
        </div>
        {message && (
          <p className="text-sm text-ink-soft" role="status">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
