"use client";

import * as React from "react";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { useActions, useApiKeys, useRole } from "@/lib/store";
import { can } from "@/lib/rbac";
import { Building2, Loader2 } from "lucide-react";

const POLL_INTERVAL_MS = 4_000;

/**
 * Sillage Account Mapping — the third real sourcing channel (alongside GitHub
 * and web search): the operator points Aria at a company (domain or LinkedIn
 * URL) whose people plausibly fit the JD — a peer, a competitor with the right
 * stack — and gets back real, named, contactable profiles. Gated behind the
 * same "source" permission as the other sourcing buttons, and only rendered
 * once a Sillage key is connected (Settings → API Keys).
 */
export function SourceSillageButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const actions = useActions();
  const role = useRole();
  const apiKeys = useApiKeys();
  const { toast } = useToast();
  const idBase = React.useId();

  const [open, setOpen] = React.useState(false);
  const [identifier, setIdentifier] = React.useState("");
  const [starting, setStarting] = React.useState(false);
  const [polling, setPolling] = React.useState<{ requestId: string; label: string } | null>(null);
  const pollTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = React.useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  // Stop polling on unmount so a closed/navigated-away tab never keeps hitting
  // /api/source/sillage/status in the background.
  React.useEffect(() => clearPoll, [clearPoll]);

  if (!can(role, "source")) return null;
  if (!apiKeys.some((k) => k.provider === "Sillage")) return null;

  function resetAndClose() {
    clearPoll();
    setIdentifier("");
    setStarting(false);
    setPolling(null);
    setOpen(false);
  }

  async function poll(requestId: string) {
    const res = await actions.checkSillageMapping(campaignId, requestId);
    if (!res.ok) {
      clearPoll();
      setPolling(null);
      toast({ title: "Sillage mapping failed", description: res.error, variant: "error" });
      return;
    }
    if (res.status === "processing") return;
    clearPoll();
    resetAndClose();
    if (res.added === 0) {
      toast({
        title: `No new candidates from ${res.company}`,
        description: "Every resolved profile already matched an existing candidate.",
        variant: "warning",
      });
      return;
    }
    toast({
      title: `Sourced ${res.added} candidate${res.added === 1 ? "" : "s"} via Sillage`,
      description: `Real profiles resolved from ${res.company}, scored and placed in Sourced.`,
      variant: "success",
    });
  }

  async function handleSubmit() {
    const trimmed = identifier.trim();
    if (!trimmed) {
      toast({ title: "Enter a company domain or LinkedIn URL", variant: "warning" });
      return;
    }
    setStarting(true);
    const res = await actions.startSillageMapping(campaignId, trimmed);
    setStarting(false);
    if (!res.ok) {
      toast({ title: "Couldn't start Sillage mapping", description: res.error, variant: "error" });
      return;
    }
    setPolling({ requestId: res.requestId, label: trimmed });
    pollTimer.current = setInterval(() => void poll(res.requestId), POLL_INTERVAL_MS);
  }

  return (
    <>
      <Button
        variant="secondary"
        leftIcon={<Building2 className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Resume the campaign to source via Sillage" : undefined}
      >
        Source via Sillage
      </Button>
      <Modal
        open={open}
        onClose={resetAndClose}
        title="Source via Sillage"
        description="Resolve a company into real, contactable employee profiles via Sillage Account Mapping."
        footer={
          polling ? (
            <Button variant="ghost" size="md" onClick={resetAndClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={handleSubmit}
                loading={starting}
                disabled={starting || !identifier.trim()}
              >
                Start mapping
              </Button>
            </>
          )
        }
      >
        {polling ? (
          <div className="flex items-center gap-3 rounded-2xl bg-ink/[0.03] px-4 py-3.5 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Mapping {polling.label} via Sillage — this can take a minute.
          </div>
        ) : (
          <Field
            label="Company domain or LinkedIn URL"
            htmlFor={`${idBase}-identifier`}
            hint="A peer, competitor, or any company whose people plausibly fit this role."
          >
            <Input
              id={`${idBase}-identifier`}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="acme.com or linkedin.com/company/acme"
              autoComplete="off"
            />
          </Field>
        )}
      </Modal>
    </>
  );
}
