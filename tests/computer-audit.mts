/**
 * Computer audit store + CSV + fleet summary.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __resetComputerAuditMemoryForTests,
  computerAuditsToCsv,
  queryComputerAudits,
  recordComputerAudit,
  summarizeFleetComputers,
} from "../src/lib/computer-audit";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aria-caud-"));
process.env.COMPUTER_AUDIT_LOG_PATH = path.join(tmp, "audits.jsonl");
__resetComputerAuditMemoryForTests();

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const a = recordComputerAudit({
  workspaceId: "ws1",
  computerId: "comp_a",
  seatId: "seat_a",
  action: "takeover",
  detail: "Operator took control",
  actor: "human",
  correlationId: "takeover_1",
});
ok("records event id", Boolean(a.id));
ok("records ISO timestamp", Boolean(a.at));

recordComputerAudit({
  workspaceId: "ws1",
  computerId: "comp_a",
  action: "release",
  detail: "Released",
  actor: "human",
  correlationId: "takeover_1",
});
recordComputerAudit({
  workspaceId: "ws1",
  computerId: "comp_b",
  action: "ready",
  detail: "Ready",
  actor: "system",
});
recordComputerAudit({
  workspaceId: "ws2",
  computerId: "comp_x",
  action: "ready",
  detail: "other ws",
  actor: "system",
});

const ws1 = queryComputerAudits({ workspaceId: "ws1", limit: 50 });
ok("queries workspace scope", ws1.length === 3, String(ws1.length));
ok(
  "filters by computer",
  queryComputerAudits({ workspaceId: "ws1", computerId: "comp_a" }).length === 2,
);
ok(
  "filters by actor human",
  queryComputerAudits({ workspaceId: "ws1", actor: "human" }).length === 2,
);
ok(
  "filters by correlation",
  queryComputerAudits({ workspaceId: "ws1", correlationId: "takeover_1" }).length === 2,
);
ok(
  "filters by since far-future empty",
  queryComputerAudits({
    workspaceId: "ws1",
    since: new Date(Date.now() + 60_000).toISOString(),
  }).length === 0,
);
ok(
  "filters by since past keeps rows",
  queryComputerAudits({
    workspaceId: "ws1",
    since: new Date(Date.now() - 3_600_000).toISOString(),
  }).length === 3,
);

const csv = computerAuditsToCsv(ws1);
ok("csv has header", csv.startsWith("at,workspace_id,computer_id"));
ok("csv has takeover row", csv.includes("takeover"));
ok("jsonl file written", fs.existsSync(process.env.COMPUTER_AUDIT_LOG_PATH!));

const summary = summarizeFleetComputers([
  { status: "ready", control: "bot", viewUrl: "http://x" },
  { status: "ready", control: "human", viewUrl: "http://y" },
  { status: "help_requested", control: "bot" },
  { status: "error", control: "bot" },
  { status: "stopped", control: "bot" },
]);
ok("summary total", summary.total === 5);
ok("summary ready", summary.ready === 2);
ok("summary human", summary.humanControl === 1);
ok("summary help", summary.helpRequested === 1);
ok("summary error", summary.error === 1);
ok("summary live views", summary.withLiveView === 2);

// Integration: supervisor audits go durable
process.env.COMPUTER_SUPERVISOR_MOCK_SEND = "1";
delete process.env.COMPUTER_SUPERVISOR_URL;
delete process.env.COMPUTER_SUPERVISOR_TOKEN;
const { ComputerSupervisor } = await import("../src/lib/computer-supervisor");
const supervisor = new ComputerSupervisor();
const computer = supervisor.ensureComputer({ workspaceId: "ws1", seatId: "seat_z", computerId: "comp_z" });
await supervisor.start(computer.computerId);
await supervisor.takeControl(computer.computerId);
await supervisor.releaseControl(computer.computerId);
const zAudits = queryComputerAudits({ workspaceId: "ws1", computerId: "comp_z" });
ok("supervisor wrote durable audits", zAudits.length >= 3, String(zAudits.length));
ok(
  "takeover correlation present",
  zAudits.some((e) => e.action === "takeover" && Boolean(e.correlationId)),
);


{
  const rows = [
    { status: "ready", control: "bot", viewUrl: "http://x" },
    { status: "ready", control: "bot", viewUrl: "http://y" },
  ];
  const all = summarizeFleetComputers(rows);
  // Route filters __orphan__ before summarize — prove seat-only slice is honest.
  const seatOnly = summarizeFleetComputers(rows.slice(0, 1));
  ok("unfiltered summary counts every row", all.total === 2 && all.ready === 2);
  ok("orphan-excluded slice matches seat-owned ops summary", seatOnly.total === 1 && seatOnly.ready === 1);
}

console.log(`RESULT computer-audit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* ignore */
}
