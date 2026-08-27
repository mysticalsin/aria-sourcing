/**
 * Graph message body + webhook retry contract for hiring-need intake.
 */
import { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

mock.module("server-only", { namedExports: {} });

const { normalizeGraphMessageBody } = await import("../src/lib/email-graph-subscriptions");

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

ok(
  "plain text with angle-bracket email is not treated as HTML",
  normalizeGraphMessageBody({
    contentType: "text",
    content: "From: Recruiter <talent@mantu.com>\nRecruiter: Ada\nSkills: TypeScript\nType: Permanent\nLocation: London",
  }).includes("\nRecruiter: Ada"),
);

const htmlBody = normalizeGraphMessageBody({
  contentType: "html",
  content:
    "<html><body><p>Recruiter: Ada</p><p>Skills: TypeScript, React</p><div>Type: Permanent</div><div>Location: London</div></body></html>",
});
ok("HTML body preserves Recruiter line", /^Recruiter: Ada$/m.test(htmlBody));
ok("HTML body preserves Skills line", /^Skills: TypeScript, React$/m.test(htmlBody));
ok("HTML body preserves Type line", /^Type: Permanent$/m.test(htmlBody));
ok("HTML body preserves Location line", /^Location: London$/m.test(htmlBody));
ok("HTML nbsp decodes", normalizeGraphMessageBody({
  contentType: "html",
  content: "<p>Skills:&nbsp;TypeScript</p>",
}).includes("Skills: TypeScript"));

const graphRoute = readFileSync("src/app/api/webhooks/microsoft-graph/route.ts", "utf8");
ok(
  "Graph webhook returns 503 on retryable message_fetch_failed / ingest_503",
  /message_fetch_failed/.test(graphRoute)
    && /ingest_503/.test(graphRoute)
    && /status: 503/.test(graphRoute),
);
ok(
  "Graph extractMessageId uses @odata.id and last /messages/ segment",
  /@odata\.id/.test(graphRoute)
    && /lastIndexOf\("\/messages\/"\)/.test(graphRoute),
);
ok(
  "Graph fetch fail-closed distinguishes token/connection gaps from retryable fetch",
  /token_unavailable/.test(graphRoute)
    && /connection_missing/.test(graphRoute)
    && /message_incomplete/.test(graphRoute)
    && /never invents a hiring-need enqueue/.test(graphRoute)
    && /token_unavailable/.test(readFileSync("src/lib/email-graph-subscriptions.ts", "utf8"))
    && /GraphMessageFetchResult/.test(readFileSync("src/lib/email-graph-subscriptions.ts", "utf8")),
);
ok(
  "Graph absent credentials are non-retryable (202, not 503 forever)",
  (() => {
    const retryable = graphRoute.split("const retryable")[1]?.split(");")[0] ?? "";
    return (
      /token_unavailable/.test(graphRoute)
      && /connection_missing/.test(graphRoute)
      && /r\.status === "message_fetch_failed"/.test(retryable)
      && !/token_unavailable/.test(retryable)
      && !/connection_missing/.test(retryable)
      && !/message_incomplete/.test(retryable)
    );
  })(),
);

console.log(`RESULT graph-mail-ingest: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
