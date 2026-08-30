import {
  buildHermesSessionKey,
  buildHermesUpstreamPath,
  resolveHermesProfilePrefix,
} from "../src/lib/api/hermes-proxy";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

ok("profile prefix is stable per workspace", resolveHermesProfilePrefix(workspaceA) === `ws-${workspaceA}`);
ok("different workspaces get different profile prefixes", resolveHermesProfilePrefix(workspaceA) !== resolveHermesProfilePrefix(workspaceB));
ok("invalid workspace id falls back to default profile", resolveHermesProfilePrefix("not-a-uuid") === "default");

const sessionA = buildHermesSessionKey({ workspaceId: workspaceA, campaignId: "camp-1", candidateId: "cand-1" });
const sessionB = buildHermesSessionKey({ workspaceId: workspaceB, campaignId: "camp-1", candidateId: "cand-1" });
ok("session key includes workspace scope", sessionA === `${workspaceA}:camp-1:cand-1`);
ok("cross-workspace session keys differ", sessionA !== sessionB);
ok("session key rejects embedded newlines", buildHermesSessionKey({ workspaceId: workspaceA, campaignId: "a\nb", candidateId: "c" }) === undefined);

ok(
  "upstream path uses profile multiplex prefix",
  buildHermesUpstreamPath("/v1/chat/completions", `ws-${workspaceA}`) === `/p/ws-${workspaceA}/v1/chat/completions`,
);
ok("default profile keeps bare path", buildHermesUpstreamPath("/v1/chat/completions", "default") === "/v1/chat/completions");

console.log(`RESULT hermes-profile-multiplexing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
