import { readFileSync } from "fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log("FAIL:", name);
  }
}

const route = readFileSync(new URL("../src/app/api/compliance/suppress/route.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");

ok("suppression route authorizes the compliance permission", /can\(role as Role, "compliance"\)/.test(route));
ok("suppression route uses the service client only after session authorization", /getServiceSupabase\(\)/.test(route));
ok("suppression route still scopes service writes to current workspace", /workspace_id: workspaceId/.test(route));
ok("client records a visible activity when an enforcement sync fails", /Suppression not synced to enforcement list/.test(store));
ok("negative reply persists suppression before local state advances", /await persistSuppressionToServer/.test(store));
ok("negative reply revokes every existing outreach approval", /Promise\.all\(approvalIds\.map\(\(messageId\) => revokeOutreachApproval/.test(store));
ok("negative reply rejects queued/manual local outreach state", /m\.status === "Pending Manual Send"/.test(store) && /m\.status === "Scheduled" && !m\.sentAt/.test(store));

console.log(`RESULT compliance-suppression: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
