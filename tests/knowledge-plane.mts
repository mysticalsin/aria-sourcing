/* ==========================================================================
   tests/knowledge-plane.mts
   Wiki/graph knowledge plane is recall-only — never a contact lock.
   Durable markdown wiki under a temp root.
   ========================================================================== */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FileWikiKnowledgePlane,
  seedJavaDeveloperWiki,
} from "../src/lib/knowledge-plane";
import { knowledgePlaneMayGrantContactClaim } from "../src/lib/contact-lease";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log("  ok ", name);
  } else {
    fail++;
    console.log("FAIL:", name, detail);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aria-wiki-test-"));
ok("knowledgePlaneMayGrantContactClaim is false", knowledgePlaneMayGrantContactClaim() === false);

const plane = new FileWikiKnowledgePlane(tmp);
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
ok("wiki path on disk", Boolean(snap.wikiPath && fs.existsSync(snap.wikiPath!)));
ok(
  "note markdown written",
  fs.existsSync(path.join(snap.wikiPath!, "notes", "who_what__amacan.md")),
);

const brief = plane.compileDraftContext("ws", "camp");
ok("draft context mentions recall-only", /recall only|Postgres lease/i.test(brief));
ok("draft context includes note body", /Calypso/.test(brief));

// Reload from disk via fresh plane instance
const plane2 = new FileWikiKnowledgePlane(tmp);
const snap2 = plane2.readCampaign("ws", "camp");
ok("durable reload notes", snap2.notes.length === 1 && /Calypso/.test(snap2.notes[0].body));
ok("durable reload edges", snap2.edges.length === 1);

const java = await seedJavaDeveloperWiki("ws", "camp_java", plane);
ok("java wiki seeded notes", java.notes.length >= 5, String(java.notes.length));
ok(
  "java suggests github query",
  plane.suggestGithubQuery("ws", "camp_java") === "language:Java followers:>20",
);
ok(
  "java suggests linkedin query first",
  plane.suggestLinkedInQuery("ws", "camp_java") ===
    'Senior Java Developer OR "Java Engineer" Spring Boot',
);
ok("java grantsContactClaim still false", java.grantsContactClaim === false);

console.log(`RESULT knowledge-plane: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
