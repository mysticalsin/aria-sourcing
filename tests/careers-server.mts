import { isRecentCareerSubmissionDuplicate, parseCareersWorkspaceId } from "../src/lib/careers-server";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
ok("fails closed when the public careers workspace is absent", parseCareersWorkspaceId("") === null);
ok("fails closed when the public careers workspace is malformed", parseCareersWorkspaceId("not-a-workspace") === null);
ok("accepts an explicit UUID workspace configuration", parseCareersWorkspaceId(workspaceId) === workspaceId);

const now = "2026-07-09T12:00:00.000Z";
const candidate = { email: "ada@example.com", campaignId: "campaign-a", createdAt: now };
ok(
  "deduplicates a recent application for the same public role without exposing the prior submission",
  isRecentCareerSubmissionDuplicate([{ email: "ADA@example.com", campaignId: "campaign-a", createdAt: "2026-07-09T11:30:00.000Z" }], candidate, now),
);
ok(
  "does not merge applications for different public roles",
  !isRecentCareerSubmissionDuplicate([{ email: "ada@example.com", campaignId: "campaign-b", createdAt: "2026-07-09T11:30:00.000Z" }], candidate, now),
);
ok(
  "allows a new application after the duplicate window expires",
  !isRecentCareerSubmissionDuplicate([{ email: "ada@example.com", campaignId: "campaign-a", createdAt: "2026-07-08T10:00:00.000Z" }], candidate, now),
);

console.log(`RESULT careers-server: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
