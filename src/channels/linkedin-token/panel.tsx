"use client";

import * as React from "react";

import { RISK_NOTICE } from "@/channels/linkedin-token/notice";
import { Button, Field, Input, Textarea } from "@/components/ui";

const WORKSPACE = "synthetic-workspace";

interface View {
  ok?: boolean;
  reason?: string;
  enabled?: boolean;
  acknowledgement?: string | null;
  tokenStored?: boolean;
  paused?: boolean;
  pauseReason?: string | null;
  killSwitch?: boolean;
  e2e?: boolean;
  queue?: { id: string; state: string }[];
  audit?: { action: string; at: string }[];
  infrastructure?: boolean;
}

async function post(action: string, extra: Record<string, unknown> = {}): Promise<View> {
  const response = await fetch("/api/channels/linkedin-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, workspaceId: WORKSPACE, ...extra }),
  });
  return (await response.json()) as View;
}

export function LinkedInTokenPanel() {
  const [role, setRole] = React.useState("member");
  const [demo, setDemo] = React.useState(false);
  const [view, setView] = React.useState<View | null>(null);
  const [notice, setNotice] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const [token, setToken] = React.useState("");
  const [recipient, setRecipient] = React.useState("ACoAASyntheticAda01");
  const [subject, setSubject] = React.useState("Synthetic note");
  const [body, setBody] = React.useState("Hello Ada, this is a synthetic note.");
  const [approvedBody, setApprovedBody] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState("");
  const [hold, setHold] = React.useState(false);
  const [approvalSeconds, setApprovalSeconds] = React.useState("3600");
  const [busy, setBusy] = React.useState("");
  const generation = React.useRef(0);
  const sessionTicket = React.useRef(0);

  const refresh = React.useCallback(async (ticket?: number) => {
    const response = await fetch(`/api/channels/linkedin-token?workspaceId=${WORKSPACE}`, { cache: "no-store" });
    if (ticket !== undefined && sessionTicket.current !== ticket) return;
    const payload = (await response.json()) as View;
    setView(payload);
  }, []);

  React.useEffect(() => {
    const ticket = ++sessionTicket.current;
    void (async () => {
      const session = (await (await fetch("/api/channels/linkedin-token/session", { cache: "no-store" })).json()) as {
        role?: string;
        e2e?: boolean;
      };
      if (sessionTicket.current !== ticket) return;
      setRole(session.role ?? "member");
      setDemo(session.e2e === true);
      await refresh(ticket);
    })();
  }, [refresh]);

  async function chooseRole(next: string) {
    const ticket = ++sessionTicket.current;
    await fetch("/api/channels/linkedin-token/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    if (sessionTicket.current !== ticket) return;
    setRole(next);
    await refresh(ticket);
  }

  async function enable() {
    const result = await post("enable", { acknowledgement: ack ? RISK_NOTICE : "" });
    setNotice(result.ok ? "Channel enabled." : `Enable refused: ${result.reason ?? "refused"}`);
    await refresh();
  }

  async function saveToken() {
    const result = await post("token", { token });
    setToken("");
    setNotice(result.ok ? "A token is stored. It is not shown again." : `Token refused: ${result.reason ?? "refused"}`);
    await refresh();
  }

  function draft() {
    const issuedAt = Date.now();
    return {
      nonce: nonce || `n-${issuedAt}`,
      recipient,
      subject,
      body,
      mode: "manual",
      qcPass: false,
      autoOptIn: false,
      senderId: "sender-synthetic",
      issuedAt,
      expiresAt: issuedAt + (Number(approvalSeconds) || 3600) * 1000,
    };
  }

  async function approve() {
    const next = `n-${Date.now()}`;
    setNonce(next);
    const fields = { ...draft(), nonce: next };
    const result = await post("approve", fields);
    setApprovedBody(result.ok ? body : null);
    setNotice(result.ok ? "Exact text approved." : `Approval refused: ${result.reason ?? "refused"}`);
    await refresh();
  }

  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 200);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  function nextGeneration(): number {
    generation.current += 1;
    return generation.current;
  }

  async function deliver(action: "send" | "enqueue", extra: Record<string, unknown> = {}) {
    const gen = nextGeneration();
    setBusy(action);
    const finish = async (result: View) => {
      if (generation.current !== gen) return;
      setBusy("");
      setNotice(`${action} ${result.ok ? "accepted" : `refused: ${result.reason ?? "refused"}`}`);
      await refresh();
    };
    if (action === "enqueue") {
      void post(action, { ...draft(), ...extra }).then((result) => void finish(result));
      return;
    }
    await finish(await post(action, { ...draft(), ...extra }));
  }

  const privileged = role === "admin" || role === "owner";

  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-labelledby="linkedin-token-title">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Outreach channel</p>
        <h1 id="linkedin-token-title" className="display text-3xl text-ink">
          LinkedIn token
        </h1>
        <p className="text-sm text-muted">
          Synthetic candidate Ada Sample. This channel is off until an owner or admin records the risk notice.
        </p>
        <p className="text-sm">
          Signed in as <strong data-testid="current-role">{role}</strong>
        </p>
        {demo ? (
          <div className="flex flex-wrap gap-2" aria-label="Demo role">
            {["member", "admin", "owner"].map((item) => (
              <Button key={item} type="button" size="sm" variant={role === item ? "primary" : "outline"} onClick={() => void chooseRole(item)}>
                Act as {item}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      <div role="status" data-testid="channel-notice" className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
        {notice || (view?.reason === "role" ? "Only an owner or an admin can view this channel." : "The switch is off.")}
      </div>

      {privileged && view?.ok !== false && view?.reason !== "role" ? (
        <div className="space-y-4 rounded-3xl border border-line bg-paper p-5">
          <button
            type="button"
            role="switch"
            aria-checked={view?.enabled === true}
            aria-label="LinkedIn token channel"
            className="rounded-full border border-ink/15 px-4 py-2 text-sm"
            onClick={() => void (view?.enabled ? post("disable").then(() => refresh()) : enable())}
          >
            {view?.enabled ? "On" : "Off"}
          </button>
          <p data-testid="risk-notice" className="text-sm text-ink">
            {RISK_NOTICE}
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="risk-ack"
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            I acknowledge this risk
          </label>
          <Button type="button" onClick={() => void enable()} disabled={view?.enabled === true}>
            Enable LinkedIn token channel
          </Button>
          <p className="text-xs text-muted" data-testid="approval-status">
            {approvedBody ? "Exact text is approved." : "No exact-text approval yet."}
          </p>
          <p className="text-xs text-muted" data-testid="token-status">
            {view?.tokenStored ? "A token is stored. It is not shown again." : "No token stored."}
          </p>
          <Field label="Session token" htmlFor="session-token">
            <Input
              id="session-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <Button type="button" variant="outline" onClick={() => void saveToken()}>
            Save token
          </Button>
          <Field label="Recipient" htmlFor="recipient">
            <Input id="recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </Field>
          <Field label="Subject" htmlFor="subject">
            <Input id="subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </Field>
          {demo ? (
            <Field label="Approval seconds" htmlFor="approval-seconds">
              <Input id="approval-seconds" value={approvalSeconds} onChange={(event) => setApprovalSeconds(event.target.value)} />
            </Field>
          ) : null}
          <Field label="Message" htmlFor="message">
            <Textarea id="message" value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void approve()}>
              Approve exact text
            </Button>
            <Button type="button" onClick={() => void deliver("send")}>
              Send
            </Button>
            <Button type="button" variant="subtle" onClick={() => void deliver("enqueue", { hold })}>
              Queue send
            </Button>
          </div>
          {demo ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hold} onChange={(event) => setHold(event.target.checked)} />
              Hold the fake server
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" onClick={() => {
              const gen = nextGeneration();
              void post("kill").then(async (result) => {
                if (generation.current !== gen) return;
                setNotice(result.ok ? "Kill switch on. Queued sends stopped." : `Kill refused: ${result.reason ?? "refused"}`);
                await refresh();
              });
            }}>
              Kill switch
            </Button>
            <Button type="button" variant="outline" onClick={() => void deliver("send", { fakeStatus: 429 })}>
              Send throttled
            </Button>
            <Button type="button" variant="outline" onClick={() => void deliver("send", { challenge: true })}>
              Send challenge
            </Button>
            <Button type="button" variant="outline" onClick={() => void deliver("send", { delayMs: 5_000 })}>
              Send slow
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                const gen = nextGeneration();
                void post("disable").then(async (result) => {
                  if (generation.current !== gen) return;
                  setNotice(result.ok ? "Off. Token purged and queued sends cancelled." : `Disable refused: ${result.reason ?? "refused"}`);
                  setAck(false);
                  await refresh();
                });
              }}
            >
              Turn off and purge
            </Button>
          </div>
          <p className="text-sm" data-testid="pause-state">
            {view?.paused ? `Paused: ${view.pauseReason ?? "paused"}` : "Not paused."}
            {view?.killSwitch ? " Kill switch engaged." : ""}
            {busy ? " Send in progress." : ""}
          </p>
          <div data-testid="queue-state" className="text-sm">
            {(view?.queue ?? []).map((item) => (
              <p key={item.id}>
                Queue {item.state}
              </p>
            ))}
          </div>
          <ul aria-label="Audit log" className="space-y-1 text-sm">
            {(view?.audit ?? []).map((entry, index) => (
              <li key={`${entry.at}-${entry.action}-${index}`}>
                Audit {entry.action}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">A non-admin cannot enable this channel or read its token status.</p>
      )}
    </section>
  );
}
