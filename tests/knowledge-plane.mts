/* ==========================================================================
   tests/knowledge-plane.mts
   Wiki/graph knowledge plane is recall-only — never a contact lock.
   ========================================================================== */

import { InMemoryKnowledgePlane } from "../src/lib/knowledge-plane";
import { knowledgePlaneMayGrantContactClaim } from "../src/lib/contact-lease";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

ok("knowledgePlaneMayGrantContactClaim is false", knowledgePlaneMayGrantContactClaim() === false);

const plane = new InMemoryKnowledgePlane();
await plane.upsertNote({
  id: "n1",
  workspaceId: "ws",
  campaignId: "camp",
  kind: "who_what",
  title: "AMACAN",
  body: "BNPP CIB Canada Calypso BA",
});
await plane.upsertEdge({
  id: "e1",
  workspaceId: "ws",
  campaignId: "camp",
  kind: "EXTRACTED",
  fromLabel: "role",
  toLabel: "Calypso",
  relation: "requires",
});

const snap = plane.readCampaign("ws", "camp");
ok("snapshot includes notes", snap.notes.length === 1);
ok("snapshot includes edges", snap.edges.length === 1);
ok("snapshot grantsContactClaim false", snap.grantsContactClaim === false);

const brief = plane.compileDraftContext("ws", "camp");
ok("draft context mentions recall-only", /recall only|Postgres lease/i.test(brief));
ok("draft context includes note body", /Calypso/.test(brief));

console.log(`RESULT knowledge-plane: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
