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
import { useActions, useHydrated, useSettings } from "@/lib/store";
import {
  summarizeCampaignLaunch,
  type LaunchRoleResult,
} from "@/lib/store/campaign-launch";
import { Radio, Rocket, ShieldCheck, Sparkles } from "lucide-react";

/* ============================================================================
   2.2 Sourcing War Room — paste a multi-role brief, launch N campaigns that
   source in parallel. Offline-safe by construction:
     - Role blocks are split on a line of `---` (pure string parsing, no I/O).
     - parseIntakeLive already carries its own three-layer fallback (mock-ai.ts
       heuristic is canonical whenever no cloud provider is configured).
     - Sourcing runs via sourceNextBatch with platform "Talent Pool", which is
       the one branch of sourceNextBatch that never calls `/api/source` — it
       goes straight to the deterministic synthetic generator (see the
       Referral/Talent Pool branch, store.ts sourceNextBatch). No network,
       ever, regardless of how settings are configured.
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

const SAMPLE_BRIEF = [
  `Title: Senior Backend Engineer
We're growing the platform team and adding a Senior Backend Engineer, fully remote (EU timezone). 5+ years with Go, Kubernetes and PostgreSQL required; Kafka is a nice-to-have. Salary 90k-125k EUR. Team of 8 engineers, reporting to the Engineering Manager.`,
  `Title: Frontend Engineer
Expanding the product team with a Frontend Engineer for our React/TypeScript app, hybrid (Germany). 3+ years with React, TypeScript and Next.js. GraphQL a plus. Salary 70k-95k EUR.`,
  `Title: Data Engineer
Building out the data platform: adding a Data Engineer with Python, Spark and Airflow experience, remote (EU). 4+ years, dbt and Snowflake nice to have. Salary 85k-110k EUR.`,
  `Title: Product Designer
Growing design with a Product Designer for our design systems, hybrid (UK). 4+ years, Figma and Accessibility required. Salary 65k-85k GBP.`,
  `Title: Account Executive
Adding an Account Executive to close new logos, remote (US). 3+ years selling SaaS, CRM and negotiation skills required. Salary 80k-100k USD plus commission.`,
  `Title: Product Manager
Expanding product with a Product Manager for the platform line, hybrid (EU). 5+ years shipping B2B SaaS. Salary 90k-115k EUR.`,
].join("\n---\n");

/** Deterministic offline sourcing waves per launched role — every wave calls
 *  sourceNextBatch with platform "Talent Pool" (synthetic, no fetch); the
 *  short delay between waves is purely cosmetic staging for the count-up. */
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
    setRaw(SAMPLE_BRIEF);
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
    block: string,
  ): Promise<LaunchRoleResult | null> {
    const parsed = await parseIntakeLive(settings, { email: block });
    if (launchSeqRef.current !== seq) return null; // superseded by a newer launch

    const campaign = actions.createCampaignFromAnalysis(parsed.jobAnalysis, {
      hiringManager: parsed.sender.name || "Hiring Manager",
      hiringManagerEmail: parsed.sender.email || "unknown@company.example",
    });
    if (!campaign) return { created: false, sourcingComplete: false };
    if (launchSeqRef.current !== seq) return null;
    setLanes((prev) => [...prev, { campaignId: campaign.id, sourcing: true }]);

    for (let wave = 0; wave < SOURCING_WAVES; wave++) {
      if (launchSeqRef.current !== seq) return null;
      const sourceResult = await actions.sourceNextBatch(campaign.id, {
        platform: "Talent Pool",
        count: PER_WAVE,
      });
      if (!sourceResult.ok) {
        setLaneSourcing(campaign.id, false);
        return { created: true, sourcingComplete: false };
      }
      if (wave < SOURCING_WAVES - 1) await wait(WAVE_DELAY_MS);
    }
    if (launchSeqRef.current === seq) setLaneSourcing(campaign.id, false);
    return launchSeqRef.current === seq
      ? { created: true, sourcingComplete: true }
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

    const results = await Promise.all(roleBlocks.map((block) => launchRole(seq, block)));

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
                Each block is parsed offline into a structured brief, then becomes its own campaign with
                deterministic sourcing: zero network required, nothing is sent.
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
    <div className="space-y-6" aria-hidden>
      <div className="card-surface space-y-4 p-6">
        <div className="skeleton h-4 w-1/3 rounded-xl" />
        <div className="skeleton h-64 w-full rounded-2xl" />
        <div className="skeleton h-11 w-1/3 rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-surface space-y-3 p-6">
            <div className="skeleton h-4 w-1/2 rounded-xl" />
            <div className="skeleton h-10 w-1/3 rounded-xl" />
            <div className="skeleton h-3 w-2/3 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
