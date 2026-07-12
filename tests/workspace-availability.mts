import { mock } from "node:test";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

type Reply<T> = { data: T; error: { message: string } | null };

let authReply: Reply<{ user: { id: string } | null }> = {
  data: { user: { id: "operator-1" } },
  error: null,
};
let authThrows = false;
let workspaceReply: Reply<string | null> = { data: "workspace-1", error: null };
let roleReply: Reply<string | null> = { data: "admin", error: null };
let stateReply: Reply<{ state: unknown; updated_at: string | null } | null> = {
  data: null,
  error: null,
};
let seatsReply: Reply<unknown[]> = { data: [], error: null };
let maybeSingleReplies: Reply<unknown>[] | null = null;

const supabase = {
  auth: {
    getUser: async () => {
      if (authThrows) throw new Error("auth transport failed");
      return authReply;
    },
  },
  rpc: async (name: string) => (name === "ensure_workspace" ? workspaceReply : roleReply),
  from: (table: string) => {
    const query = {
      select: () => query,
      update: () => query,
      upsert: () => query,
      eq: () => query,
      maybeSingle: async () => maybeSingleReplies?.shift() ?? stateReply,
      order: async () => (table === "agent_seats" ? seatsReply : { data: [], error: null }),
    };
    return query;
  },
};

mock.module(moduleUrl("src/lib/supabase/client.ts"), {
  namedExports: {
    getBrowserSupabase: () => supabase,
  },
});

const { loadRemoteAgentSeats, loadRemoteState, saveRemoteState } = await import("../src/lib/supabase/workspace.ts");

authThrows = true;
let workspace = await loadRemoteState();
ok(
  "thrown auth transport failure is classified as auth unavailable",
  workspace?.status === "unavailable" && workspace.dependency === "auth",
);
authThrows = false;

authReply = { data: { user: null }, error: { message: "auth service unavailable" } };
workspace = await loadRemoteState();
ok(
  "auth read failure is unavailable rather than signed out or empty",
  workspace?.status === "unavailable" && workspace.dependency === "auth",
);

authReply = { data: { user: null }, error: null };
workspace = await loadRemoteState();
ok("a confirmed anonymous session is signed out", workspace?.status === "signed_out");

authReply = { data: { user: { id: "operator-1" } }, error: null };
workspaceReply = { data: null, error: { message: "workspace RPC unavailable" } };
workspace = await loadRemoteState();
ok(
  "workspace resolution failure is unavailable rather than an empty workspace",
  workspace?.status === "unavailable" && workspace.dependency === "workspace",
);

workspaceReply = { data: "workspace-1", error: null };
roleReply = { data: null, error: { message: "role RPC unavailable" } };
workspace = await loadRemoteState();
ok(
  "authority resolution failure blocks the workspace",
  workspace?.status === "unavailable" && workspace.dependency === "workspace",
);

roleReply = { data: "unexpected-role", error: null };
workspace = await loadRemoteState();
ok(
  "invalid authority response blocks the workspace instead of inventing viewer authority",
  workspace?.status === "unavailable" && workspace.dependency === "workspace",
);

roleReply = { data: "member", error: null };
stateReply = { data: null, error: { message: "workspace state unavailable" } };
workspace = await loadRemoteState();
ok(
  "workspace-state read failure is unavailable rather than successful empty",
  workspace?.status === "unavailable" && workspace.dependency === "state",
);

const recoveredState = { version: 999, campaigns: [{ id: "real-campaign" }] };
stateReply = { data: { state: recoveredState, updated_at: "version-2" }, error: null };
workspace = await loadRemoteState();
ok(
  "retry recovery returns the authoritative persisted state and version",
  workspace?.status === "ready" &&
    workspace.state === recoveredState &&
    workspace.updatedAt === "version-2" &&
    workspace.role === "member",
);

stateReply = { data: null, error: null };
workspace = await loadRemoteState();
ok(
  "a successful read with no state row is a valid empty workspace",
  workspace?.status === "ready" && workspace.workspaceId === "workspace-1" && workspace.state === null,
);

seatsReply = { data: [], error: { message: "agent seats unavailable" } };
let seats = await loadRemoteAgentSeats();
ok(
  "authoritative agent-seat failure is unavailable rather than stale fallback",
  seats?.status === "unavailable" && seats.dependency === "agent_seats",
);

seatsReply = { data: [], error: null };
seats = await loadRemoteAgentSeats();
ok("a successful empty agent-seat read remains valid", seats?.status === "ready" && seats.seats.length === 0);

const latestTeamState = { version: 999, campaigns: [{ id: "team-campaign" }] };
maybeSingleReplies = [
  { data: null, error: null },
  { data: { state: latestTeamState, updated_at: "version-2" }, error: null },
];
const conflict = await saveRemoteState(
  "workspace-1",
  { currentRole: "member" } as never,
  "version-1",
);
ok(
  "conflict reload does not invent profile authority for a shared-state version",
  conflict.conflict === true &&
    conflict.latest?.state === latestTeamState &&
    !("role" in conflict.latest),
);

maybeSingleReplies = [
  { data: null, error: null },
  { data: null, error: { message: "latest state read unavailable" } },
];
const failedConflictRead = await saveRemoteState(
  "workspace-1",
  { currentRole: "member" } as never,
  "version-1",
);
ok(
  "failed conflict reload remains a retryable save failure instead of synthetic empty state",
  failedConflictRead.ok === false && !failedConflictRead.conflict && failedConflictRead.latest === undefined,
);

maybeSingleReplies = [
  { data: null, error: null },
  { data: null, error: null },
];
const missingConflictRow = await saveRemoteState(
  "workspace-1",
  { currentRole: "member" } as never,
  "version-1",
);
ok(
  "missing latest conflict row remains failed instead of becoming an empty workspace",
  missingConflictRow.ok === false && !missingConflictRow.conflict && missingConflictRow.latest === undefined,
);

maybeSingleReplies = [
  { data: null, error: null },
  { data: { state: null, updated_at: "version-2" }, error: null },
];
const nullConflictState = await saveRemoteState(
  "workspace-1",
  { currentRole: "member" } as never,
  "version-1",
);
ok(
  "null latest conflict state remains failed instead of seeding a replacement",
  nullConflictState.ok === false && !nullConflictState.conflict && nullConflictState.latest === undefined,
);

console.log(`RESULT workspace-availability: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
