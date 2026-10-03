/**
 * Soft-nav / go-live / agents panel must not paint foreign campaign VMs.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const mergeSrc = readFileSync(
  new URL("../src/lib/campaign-go-live.ts", import.meta.url),
  "utf8",
);
ok(
  "mergeDurableCampaignSeatsForGoLive does not append campaignId into assigned",
  !/assignedCampaignIds[\s\S]{0,200}campaignId,\s*\]/.test(mergeSrc) &&
    /Array\.isArray\(row\.assignedCampaignIds\) \? row\.assignedCampaignIds/.test(mergeSrc),
);

const checklist = readFileSync(
  new URL("../src/components/campaigns/campaign-go-live-checklist.tsx", import.meta.url),
  "utf8",
);
ok(
  "go-live checklist clears durableSeats on campaign change / poll fail / catch",
  /setDurableSeats\(undefined\)/.test(checklist) &&
    (checklist.match(/setDurableSeats\(undefined\)/g) ?? []).length >= 3,
);
ok(
  "go-live checklist seatsRef — seats churn must not remount / clear durable",
  /seatsRef/.test(checklist) &&
    /\[props\.campaignId, props\.computers, actions\]/.test(checklist) &&
    !/\[props\.campaignId, props\.computers, props\.seats, actions\]/.test(checklist),
);

const agents = readFileSync(
  new URL("../src/components/campaigns/campaign-agents-panel.tsx", import.meta.url),
  "utf8",
);
ok(
  "campaign agents health badges scoped to campaignSeats",
  /campaignComputers\.filter\(\(c\) => c\.sessionHealthy === true\)/.test(agents) &&
    /setComputers\(\[\]\)/.test(agents),
);
ok(
  "campaign agents use durable⊇ seatIds when campaignSeats present",
  /new Set\(data\.campaignSeats\.map\(\(s\) => s\.id\)\)/.test(agents) &&
    /Only sync when campaignSeats is present/.test(agents),
);
  ok(
    "campaign agents cards use mergeDurable when campaignSeats present",
    /mergeDurableCampaignSeatsForGoLive/.test(agents) &&
      /setDurableSeats/.test(agents),
  );
ok(
  "campaign agents ingest durable browserSeatBindings / campaignSeats",
  /ingestDurableBrowserBindings/.test(agents),
);
ok(
  "campaign agents invalidate in-flight refresh on soft-nav (pollGeneration)",
  /pollGeneration/.test(agents) &&
    /gen !== pollGeneration\.current/.test(agents) &&
    /pollGeneration\.current \+= 1/.test(agents),
);
ok(
  "campaign agents seatsRef — seats churn must not remount poll / clear durable",
  /seatsRef/.test(agents) &&
    /hermesCampaignSeatsRef/.test(agents) &&
    /\[actions, campaignId\]/.test(agents) &&
    /\[campaignId, refresh\]/.test(agents) &&
    !/\}, \[actions, hermesCampaignSeats, campaignId, seats\]\)/.test(agents),
);

const setup = readFileSync(
  new URL("../src/components/settings/setup-guide-panel.tsx", import.meta.url),
  "utf8",
);
ok(
  "setup guide clears liSessionHealthy on soft-nav before poll",
  /setLiSessionHealthy\(false\)/.test(setup) &&
    setup.indexOf("setLiSessionHealthy(false)") < setup.indexOf("const load = async"),
);
ok(
  "setup guide seatsRef — seats churn must not remount / clear durable attach",
  /seatsRef/.test(setup) &&
    /\[campaignId, actions\]/.test(setup) &&
    !/\}, \[seats, campaign, actions\]\)/.test(setup),
);

const campaignPage = readFileSync(
  new URL("../src/app/campaigns/[id]/page.tsx", import.meta.url),
  "utf8",
);
ok(
  "campaign Agents tab count prefers durable campaignSeats length",
  /durableAgentAuthority/.test(campaignPage) &&
    /durableAgentAuthority\?\.campaignId === c\.id/.test(campaignPage) &&
    /Array\.isArray\(data\.campaignSeats\) \? data\.campaignSeats\.length/.test(campaignPage) &&
    /isBrowserComputerSeat\(s\) && seatAttachedToCampaign\(s, c\.id\)/.test(campaignPage),
);
ok(
  "campaign page Agents badge poll ingests durable bindings",
  /ingestDurableBrowserBindings/.test(campaignPage),
);
ok(
  "campaign Agents badge stamps campaignId — soft-nav cannot paint foreign durable",
  /setDurableAgentAuthority\(\{ campaignId: id, count:/.test(campaignPage),
);
ok(
  "go-live checklist ingests durable bindings on fleet poll",
  /ingestDurableBrowserBindings/.test(checklist),
);

const fleetPage = readFileSync(new URL("../src/app/fleet/page.tsx", import.meta.url), "utf8");
ok(
  "fleet Take passes campaignId only when seatAttachedToCampaign(scope)",
  /seatAttachedToCampaign\(seat, fromScope\)/.test(fleetPage) &&
    !/if \(fromScope\) return \{ campaignId: fromScope \}/.test(fleetPage),
);
ok(
  "fleet Deploy omits campaignId for newly minted seats",
  /New seats from Deploy are not campaign-attached yet/.test(fleetPage),
);
ok(
  "fleet seatsRef + pollGeneration — seats churn must not wipe roster",
  /seatsRef/.test(fleetPage) &&
    /pollGeneration/.test(fleetPage) &&
    /\}, \[actions\]\)/.test(fleetPage) &&
    !/\}, \[actions, seats\]\)/.test(fleetPage),
);

const linkedinPanel = readFileSync(
  new URL("../src/components/settings/linkedin-connections-panel.tsx", import.meta.url),
  "utf8",
);
ok(
  "linkedin connections localSeatsRef — seats churn must not wipe LI healthy",
  /localSeatsRef/.test(linkedinPanel) &&
    /pollGeneration/.test(linkedinPanel) &&
    /\}, \[enabled, actions, toast\]\)/.test(linkedinPanel) &&
    !/\}, \[enabled, localSeats, toast\]\)/.test(linkedinPanel),
);

const viewport = readFileSync(
  new URL("../src/app/fleet/computers/[computerId]/viewport/page.tsx", import.meta.url),
  "utf8",
);
ok(
  "viewport Take prefers seat attach over stale computer.campaignId",
  /seatAttachedToCampaign\(hermesSeat, stamped\)/.test(viewport) &&
    !/\(computer\?\.campaignId \?\? ""\)\.trim\(\) \|\|/.test(viewport),
);

console.log(`RESULT campaign-soft-nav-attach: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
