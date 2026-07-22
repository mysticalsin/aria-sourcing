"use client";

import * as React from "react";
import { Check, Clipboard, KeyRound, Plus, ShieldX, X } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Select,
  useConfirm,
  useToast,
} from "@/components/ui";
import { can } from "@/lib/rbac";
import { useRole } from "@/lib/store";

const CREDENTIALS_ENDPOINT = "/api/admin/need-ingress/credentials";
const WEBHOOK_ENDPOINT = "/api/webhooks/needs";
const DAY_MS = 24 * 60 * 60 * 1_000;

type CredentialMetadata = {
  id: string;
  label: string;
  status: "active" | "revoked";
  expiresAt: string;
  createdAt: string | null;
  revokedAt: string | null;
};

type CredentialsResponse = {
  ok?: boolean;
  credentials?: CredentialMetadata[];
  credential?: Pick<CredentialMetadata, "id" | "label" | "status" | "expiresAt">;
  error?: string;
};

type PendingCreation = {
  fingerprint: string;
  requestId: string;
  keySha256: string;
  value: string;
  expiresAt: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

export function NeedIngressCredentialsPanel() {
  const role = useRole();
  const isAdmin = can(role, "manage_settings");
  const { toast } = useToast();
  const confirm = useConfirm();
  const [credentials, setCredentials] = React.useState<CredentialMetadata[]>([]);
  const [label, setLabel] = React.useState("");
  const [durationDays, setDurationDays] = React.useState<7 | 30 | 90>(30);
  const [loading, setLoading] = React.useState(isAdmin);
  const [creating, setCreating] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const pendingCreation = React.useRef<PendingCreation | null>(null);
  const revokeOperations = React.useRef(new Map<string, string>());

  const loadCredentials = React.useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(CREDENTIALS_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as CredentialsResponse | null;
    if (!response.ok || !body?.ok || !Array.isArray(body.credentials)) {
      throw new Error(body?.error ?? "Need ingress credentials could not be loaded.");
    }
    setCredentials(body.credentials);
  }, []);

  React.useEffect(() => {
    if (!isAdmin) {
      setCredentials([]);
      setLoading(false);
      setOneTimeCredential(null);
      pendingCreation.current = null;
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void loadCredentials(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast({
          title: "Could not load need ingress credentials",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "error",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [isAdmin, loadCredentials, toast]);

  async function createCredential() {
    const cleanLabel = label.trim();
    if (!cleanLabel || new TextEncoder().encode(cleanLabel).byteLength > 100) {
      toast({ title: "Enter a label of at most 100 bytes", variant: "warning" });
      return;
    }

    setCreating(true);
    setOneTimeCredential(null);
    setCopied(false);
    try {
      const fingerprint = `${cleanLabel}\n${durationDays}`;
      let operation = pendingCreation.current;
      if (!operation || operation.fingerprint !== fingerprint) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const value = `aria_need_v1_${base64Url(bytes)}`;
        if (value.length !== 56) throw new Error("Secure credential generation failed.");
        operation = {
          fingerprint,
          requestId: crypto.randomUUID(),
          keySha256: await sha256Hex(value),
          value,
          expiresAt: new Date(Date.now() + durationDays * DAY_MS).toISOString(),
        };
        pendingCreation.current = operation;
      }

      const response = await fetch(CREDENTIALS_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          label: cleanLabel,
          keySha256: operation.keySha256,
          expiresAt: operation.expiresAt,
          requestId: operation.requestId,
        }),
      });
      const body = (await response.json().catch(() => null)) as CredentialsResponse | null;
      if (!response.ok || !body?.ok || !body.credential) {
        throw new Error(body?.error ?? "Need ingress credential could not be created.");
      }

      setCredentials((current) => [
        {
          ...body.credential!,
          createdAt: null,
          revokedAt: null,
        },
        ...current.filter((item) => item.id !== body.credential!.id),
      ]);
      setOneTimeCredential(operation.value);
      pendingCreation.current = null;
      setLabel("");
      toast({ title: "Need ingress credential created", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not create need ingress credential",
        description: error instanceof Error ? `${error.message} Retry with the same values to reuse the request.` : "Try again.",
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  }

  async function revokeCredential(credential: CredentialMetadata) {
    if (!(await confirm({
      title: `Revoke “${credential.label}”?`,
      description: "Existing signed requests using this credential will be rejected.",
      confirmLabel: "Revoke",
      danger: true,
    }))) return;

    setRevokingId(credential.id);
    try {
      const requestId = revokeOperations.current.get(credential.id) ?? crypto.randomUUID();
      revokeOperations.current.set(credential.id, requestId);
      const response = await fetch(CREDENTIALS_ENDPOINT, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ credentialId: credential.id, requestId }),
      });
      const body = (await response.json().catch(() => null)) as CredentialsResponse | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error ?? "Need ingress credential could not be revoked.");
      }
      revokeOperations.current.delete(credential.id);
      setCredentials((current) => current.map((item) =>
        item.id === credential.id
          ? { ...item, status: "revoked", revokedAt: null }
          : item,
      ));
      toast({ title: "Need ingress credential revoked", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not revoke need ingress credential",
        description: error instanceof Error ? `${error.message} Retry to reuse the same request.` : "Try again.",
        variant: "error",
      });
    } finally {
      setRevokingId(null);
    }
  }

  async function copyOneTimeCredential() {
    if (!oneTimeCredential) return;
    try {
      await navigator.clipboard.writeText(oneTimeCredential);
      setCopied(true);
      toast({ title: "Credential copied", variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: "Select the credential and copy it manually.", variant: "error" });
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-ink">Admin managed</h3>
            <p className="mt-1 text-xs text-muted">Only workspace administrators can issue or revoke need ingress credentials.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {oneTimeCredential ? (
        <Card className="border border-warning/40 bg-warning/5">
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Copy this credential now</h3>
                <p className="mt-1 text-xs text-muted">
                  This is the only one time reveal. Aria stores only its SHA-256 digest and cannot show it again.
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Dismiss one-time credential"
                onClick={() => setOneTimeCredential(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <code className="block break-all rounded-xl border border-line bg-surface p-3 text-xs text-ink">
              {oneTimeCredential}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              onClick={copyOneTimeCredential}
            >
              {copied ? "Copied" : "Copy credential"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink/[0.05] text-ink-soft" aria-hidden>
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">Issue a tenant-bound credential</h3>
              <p className="mt-0.5 text-xs text-muted">The secret is generated in this browser. Only its digest crosses the admin API.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <Field label="Label" htmlFor="need-ingress-label" hint="Name the upstream system or environment.">
              <Input
                id="need-ingress-label"
                value={label}
                maxLength={100}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Workday production"
                disabled={creating}
              />
            </Field>
            <Field label="Expires after" htmlFor="need-ingress-duration">
              <Select
                id="need-ingress-duration"
                value={String(durationDays)}
                onChange={(event) => setDurationDays(Number(event.target.value) as 7 | 30 | 90)}
                options={[
                  { value: "7", label: "7 days" },
                  { value: "30", label: "30 days" },
                  { value: "90", label: "90 days" },
                ]}
                disabled={creating}
              />
            </Field>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<Plus className="h-4 w-4" />}
            loading={creating}
            disabled={!label.trim()}
            onClick={createCredential}
          >
            Generate credential
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Signed request contract</h3>
            <p className="mt-1 text-xs text-muted">
              POST JSON to <code>{WEBHOOK_ENDPOINT}</code>. Sign the exact body with HMAC-SHA256 over
              <code className="ml-1">aria-need-v1\n&lt;timestamp&gt;\n&lt;idempotency-key&gt;\n&lt;body&gt;</code>.
            </p>
          </div>
          <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
            <code>X-ARIA-Need-Key: &lt;credential&gt;</code>
            <code>X-ARIA-Need-Timestamp: &lt;unix-seconds&gt;</code>
            <code>Idempotency-Key: &lt;unique-request-id&gt;</code>
            <code>X-ARIA-Need-Signature: sha256=&lt;hex-hmac&gt;</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4" aria-busy={loading}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Issued credentials</h3>
            <Badge tone="neutral" size="sm">{loading ? "loading" : `${credentials.length} total`}</Badge>
          </div>
          {!loading && credentials.length === 0 ? (
            <p className="text-xs text-muted">No need ingress credentials have been issued.</p>
          ) : (
            <div className="divide-y divide-line rounded-2xl border border-line">
              {credentials.map((credential) => {
                const expired = Date.parse(credential.expiresAt) <= Date.now();
                const active = credential.status === "active" && !expired;
                return (
                  <div key={credential.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{credential.label}</span>
                        <Badge tone={active ? "success" : credential.status === "revoked" ? "danger" : "warning"} size="sm" dot>
                          {credential.status === "revoked" ? "revoked" : expired ? "expired" : "active"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">Expires {displayDate(credential.expiresAt)}</p>
                    </div>
                    {credential.status === "active" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        loading={revokingId === credential.id}
                        disabled={revokingId !== null && revokingId !== credential.id}
                        onClick={() => revokeCredential(credential)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
