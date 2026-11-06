"use client";

import * as React from "react";
import { useConfirm, useToast } from "@/components/ui";
import { linkedInApi, postJson } from "./api";
import { ConnectionBar, Onboarding } from "./connection";
import { refreshLinkedIn, useLinkedIn } from "./linkedin-store";
import { useBridgeExtension } from "./use-bridge-extension";

/**
 * Settings › Integrations › LinkedIn: the signed-in user's own LinkedIn
 * connection (the ARIA extension in their browser). Personal: every ARIA user
 * connects their own account; candidates are invited and messaged from their
 * profile in ARIA.
 */
export function LinkedInSettingsPanel() {
  const state = useLinkedIn();
  const { toast } = useToast();
  const confirm = useConfirm();
  const paired = Boolean(state.account?.paired);
  const extension = useBridgeExtension(paired);
  const { nudge } = extension;
  const [connecting, setConnecting] = React.useState(false);
  const [manualToken, setManualToken] = React.useState<string | null>(null);

  async function connect(viaExtension: boolean) {
    setConnecting(true);
    const res = await linkedInApi<{ token: string }>("/api/linkedin/account", { method: "POST" });
    if (!res.ok) {
      setConnecting(false);
      toast({ title: "Could not create a pairing code.", description: res.error, variant: "error" });
      return;
    }
    if (viaExtension && extension.detected) {
      const answer = await extension.pair(res.data.token);
      if (answer.ok) {
        setManualToken(null);
        toast({ title: "LinkedIn connected", description: "The extension is syncing your account.", variant: "success" });
      } else {
        setManualToken(res.data.token);
        toast({ title: "The extension did not take the code.", description: answer.error ?? "Paste it in the extension instead.", variant: "warning" });
      }
    } else {
      setManualToken(res.data.token);
    }
    setConnecting(false);
    await refreshLinkedIn();
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect your LinkedIn?",
      description: "The extension stops, and everything ARIA synced from your LinkedIn (candidates' standing, conversations) is deleted.",
      confirmLabel: "Disconnect and delete",
      danger: true,
    });
    if (!ok) return;
    const res = await linkedInApi("/api/linkedin/account", { method: "DELETE" });
    if (!res.ok) return toast({ title: "Disconnect failed.", description: res.error, variant: "error" });
    setManualToken(null);
    await refreshLinkedIn();
  }

  if (state.status === "disabled") {
    return (
      <p className="text-sm text-muted">
        The experimental LinkedIn bridge is off on this server. Set <span className="font-mono">LINKEDIN_BRIDGE_ENABLED=true</span> in
        .env.local and restart the app.
      </p>
    );
  }
  if (state.status === "unavailable") return <p className="text-sm text-muted">LinkedIn is unavailable: {state.detail}</p>;
  if (state.status !== "ready" || !state.account) return <div className="h-24 animate-pulse rounded-2xl bg-ink/[0.04]" aria-busy="true" />;

  if (!state.account.paired) {
    return <Onboarding extension={extension} connecting={connecting} manualToken={manualToken} onConnect={(via) => void connect(via)} />;
  }
  const policy = state.account.policy;
  return (
    <div className="space-y-3">
      <ConnectionBar
        account={state.account.account}
        policy={policy}
        unread={state.account.unread}
        extension={extension}
        transport={state.transport}
        manualToken={manualToken}
        onReconnect={() => void connect(true)}
        onNewCode={() => void connect(false)}
        onDisconnect={() => void disconnect()}
        onSync={() => void linkedInApi("/api/linkedin/conversations", postJson({})).then(() => nudge())}
      />
      <ul className="grid gap-2 text-sm text-muted sm:grid-cols-3">
        <li className="rounded-xl bg-ink/[0.03] px-3 py-2.5">
          <span className="font-semibold text-ink">From the candidate.</span> Open a sourced candidate: ARIA shows whether they are a
          connection, invites them, and keeps your conversation with them there.
        </li>
        <li className="rounded-xl bg-ink/[0.03] px-3 py-2.5">
          <span className="font-semibold text-ink">Paced.</span> Up to {policy.dailySendCap} messages and {policy.dailyInviteCap ?? 15}{" "}
          invitations a day ({policy.weeklyInviteCap ?? 80} a week), {policy.minSendIntervalSeconds ?? 90} s apart. Each one is your click.
        </li>
        <li className="rounded-xl bg-ink/[0.03] px-3 py-2.5">
          <span className="font-semibold text-ink">Only candidates.</span> Your other LinkedIn conversations are never stored or shown.
          This connection is yours alone; teammates connect their own.
        </li>
      </ul>
    </div>
  );
}
