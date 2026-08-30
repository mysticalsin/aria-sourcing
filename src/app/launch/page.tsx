"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Eyebrow,
  EmptyState,
  Textarea,
  useToast,
} from "@/components/ui";
import { PageHeader, HydrationGate } from "@/components/app/page-header";
import { WarRoomBoard, type WarRoomLane } from "@/components/launch/war-room-board";
import { parseIntakeLive } from "@/lib/ai/intake";
import { evaluateNeedReadiness } from "@/lib/needs/readiness";
import type { ParsedIntake } from "@/lib/mock-ai";
import { SAMPLE_LAUNCH_BRIEF } from "@/lib/launch/sample-brief";
import { useActions, useHydrated, useSettings } from "@/lib/store";
import {
  summarizeCampaignLaunch,
  type LaunchRoleResult,
} from "@/lib/store/campaign-launch";
import { demoLoginEnabled, supabaseEnabled } from "@/lib/supabase/config";
import { Radio, Rocket, ShieldCheck, Sparkles } from "lucide-react";

/* ============================================================================
   2.2 Sourcing War Room — paste a multi-role brief, launch N campaigns that
   source in parallel. Local demo mode is offline-safe by construction:
     - Role blocks are split on a line of `---` (pure string parsing, no I/O).
     - parseIntakeLive already carries its own three-layer fallback (mock-ai.ts
       heuristic is canonical whenever no cloud provider is configured).
     - Local demo sourcing uses the deterministic Talent Pool generator.
     - Live workspaces use the campaign's primary real source and never persist
       synthetic candidates.
   ========================================================================== */

const DELIMITER_RE = /^\s*-{3,}\s*$/;

/** Splits a pasted multi-role brief into per-role blocks on a line containing
 *  only `---` (3+ dashes, optionally padded with whitespace). Pure string
 *  parsing — no network, no parsing library, offline by construction. */
function splitRoleBlocks(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (DELIMITER_RE.test(line)) {
      blocks.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  blocks.push(current.join("\n").trim());
  return blocks.map((b) => b.trim()).filter(Boolean);
}

/** Sourcing waves per launched role. Local demo mode uses deterministic Talent
 *  Pool profiles; live workspaces use the campaign's primary real source. */
const SOURCING_WAVES = 5;
const PER_WAVE = 3;
const WAVE_DELAY_MS = 220;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LaunchPage() {
  const hydrated = useHydrated();
  const { toast } = useToast();
  const actions = useActions();
  const settings = useSettings();

  const [raw, setRaw] = React.useState("");
  const [launching, setLaunching] = React.useState(false);
  const [lanes, setLanes] = React.useState<WarRoomLane[]>([]);
  // Guards a slower earlier launch from clobbering a newer one's lane list if
  // the user re-launches before the first batch finishes sourcing.
  const launchSeqRef = React.useRef(0);

  const blocks = React.useMemo(() => splitRoleBlocks(raw), [raw]);

  function loadSample() {
    setRaw(SAMPLE_LAUNCH_BRIEF);
    toast({
      title: "Sample brief loaded",
      description: "6 roles, separated by ---, ready to launch.",
      variant: "info",
    });
  }

  function setLaneSourcing(campaignId: string, sourcing: boolean) {
    setLanes((prev) => prev.map((l) => (l.campaignId === campaignId ? { ...l, sourcing } : l)));
  }

  async function launchRole(
    seq: number,
    parsed: ParsedIntake,
  ): Promise<LaunchRoleResult | null> {
    const campaign = actions.createCampaignFromAnalysis(parsed.jobAnalysis, {
      hiringManager: parsed.sender.name,
      hiringManagerEmail: parsed.sender.email,
    });
    if (!campaign) return { created: false, sourcingComplete: false };
    if (launchSeqRef.current !== seq) return null;
    setLanes((prev) => [...prev, { campaignId: campaign.id, sourcing: true }]);

    if (supabaseEnabled) {
      const synced = await actions.flushWorkspaceSave();
      if (!synced) {
        setLaneSourcing(campaign.id, false);
        return { created: true, sourcingComplete: false };
      }
    }

    let sourcedCount = 0;
    for (let wave = 0; wave < SOURCING_WAVES; wave++) {
      if (launchSeqRef.current !== seq) return null;
      const sourceResult = await actions.sourceNextBatch(campaign.id, {
        platform: supabaseEnabled ? undefined : "Talent Pool",
        count: PER_WAVE,
      });
      if (!sourceResult.ok) {
        setLaneSourcing(campaign.id, false);
        return { created: true, sourcingComplete: false };
      }
      sourcedCount += sourceResult.accepted.length;
      if (wave < SOURCING_WAVES - 1) await wait(WAVE_DELAY_MS);
    }
    if (launchSeqRef.current === seq) setLaneSourcing(campaign.id, false);
    return launchSeqRef.current === seq
      ? { created: true, sourcingComplete: sourcedCount > 0 }
      : null;
  }

  async function handleLaunch() {
    const roleBlocks = splitRoleBlocks(raw);
    if (roleBlocks.length === 0) {
      toast({
        title: "Nothing to launch",
        description: "Paste at least one role brief first.",
        variant: "warning",
      });
      return;
    }
    const seq = ++launchSeqRef.current;
    setLaunching(true);
    setLanes([]);

    const parsedRoles = await Promise.all(
      roleBlocks.map(async (block) => {
        try {
          return await parseIntakeLive(settings, { email: block });
        } catch {
          return null;
        }
      }),
    );
    if (launchSeqRef.current !== seq) return;
    if (parsedRoles.some((p) => p == null)) {
      setLaunching(false);
      toast({
        title: "Live parse required",
        description:
          "Live JD parse requires a working cloud LLM. Configure a live provider in Settings → AI, then retry.",
        variant: "warning",
      });
      return;
    }
    const incomplete = parsedRoles.flatMap((parsed, index) => {
      const readiness = evaluateNeedReadiness(parsed!.jobAnalysis);
      return readiness.ready
        ? []
        : [{
            label: parsed!.jobAnalysis.title || `Role ${index + 1}`,
            issues: readiness.issues.map((issue) => issue.message),
          }];
    });
    if (incomplete.length > 0) {
      setLaunching(false);
      toast({
        title: "Complete every role before launch",
        description: incomplete
          .slice(0, 3)
          .map((item) => `${item.label}: ${item.issues.join(" ")}`)
          .join(" "),
        variant: "warning",
      });
      return;
    }

    const results = await Promise.all(parsedRoles.map((parsed) => launchRole(seq, parsed!)));

    if (launchSeqRef.current === seq) {
      setLaunching(false);
      const summary = summarizeCampaignLaunch(roleBlocks.length, results);

      if (summary.status === "success") {
        toast({
          title: "War room live",
          description: `${summary.sourcingComplete} role${summary.sourcingComplete === 1 ? "" : "s"} sourced in parallel: nothing sent, drafts only.`,
          variant: "success",
        });
      } else if (summary.status === "partial") {
        const failures = [
          summary.creationFailed > 0
            ? `${summary.creationFailed} campaign creation${summary.creationFailed === 1 ? "" : "s"} failed.`
            : "",
          summary.sourcingFailed > 0
            ? `${summary.sourcingFailed} sourcing run${summary.sourcingFailed === 1 ? "" : "s"} stopped.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
        toast({
          title: "Launch needs attention",
          description: `${summary.created} of ${summary.requested} campaigns were created. ${failures} Retry from the campaign workspace.`,
          variant: "warning",
        });
      } else {
        toast({
          title: "No campaigns created",
          description:
            "Your workspace is unavailable or your access is read-only. Retry after access is restored.",
          variant: "error",
        });
      }
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Launch"
        title="Sourcing war room"
        description="Paste a multi-role brief and Aria spins up one campaign per role, sourcing all of them in parallel."
        actions={
          <Badge tone="aqua" dot>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Dry-run · nothing sent
          </Badge>
        }
      />

      <HydrationGate hydrated={hydrated} fallback={<LaunchFallback />}>
        <div className="space-y-6">
          <Card className="animate-fade-in">
            <CardHeader>
              <Eyebrow>01: Multi-role brief</Eyebrow>
              <CardTitle className="mt-1">Paste one brief per role</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 pt-0">
              <Textarea
                id="launch-brief"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"Separate each role with a line containing only ---\n\nTitle: Senior Backend Engineer\nRemote (EU). 5+ years Go, Kubernetes...\n---\nTitle: Frontend Engineer\nHybrid (Germany). React, TypeScript..."}
                className="min-h-[260px] font-mono text-[0.8125rem]"
                aria-label="Multi-role brief, roles separated by a line of ---"
              />
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                {demoLoginEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    leftIcon={<Sparkles aria-hidden />}
                    onClick={loadSample}
                    disabled={launching}
                  >
                    Load sample brief (6 roles)
                  </Button>
                ) : null}
                <span className="text-xs text-muted">
                  {blocks.length} role block{blocks.length === 1 ? "" : "s"} detected
                </span>
                <Button
                  type="button"
                  leftIcon={<Rocket aria-hidden />}
                  onClick={handleLaunch}
                  loading={launching}
                  disabled={launching || blocks.length === 0}
                  className="ml-auto"
                >
                  {launching ? "Launching…" : "Launch"}
                </Button>
              </div>
              <p className="text-xs text-muted">
                {supabaseEnabled
                  ? "Each block becomes its own campaign and sources from its primary live channel. Nothing is sent."
                  : "Each block is parsed offline into a campaign with deterministic demo sourcing. Zero network required; nothing is sent."}
              </p>
            </CardBody>
          </Card>

          {lanes.length > 0 ? (
            <WarRoomBoard lanes={lanes} className="animate-fade-in" />
          ) : (
            <EmptyState
              icon={<Radio className="h-6 w-6" aria-hidden />}
              title="Awaiting launch"
              description="Paste role blocks above (separated by ---) and click Launch. A lane appears per role as its campaign spins up and sources in parallel."
            />
          )}
        </div>
      </HydrationGate>
    </div>
  );
}

function LaunchFallback() {
  return (
    <EmptyState
      title="Loading launch…"
      description="War room lanes appear after workspace hydrate — no placeholder cards."
    />
  );
}
