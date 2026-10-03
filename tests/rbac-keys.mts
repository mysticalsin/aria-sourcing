import { can } from "../src/lib/rbac";
import { validateApiKeyFormat, last4Of } from "../src/lib/providers";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- RBAC ---- */
ok("admin can manage settings", can("admin", "manage_settings"));
ok("admin can manage keys", can("admin", "manage_keys"));
ok("admin can manage fleet", can("admin", "manage_fleet"));
ok("admin can manage roles", can("admin", "manage_roles"));
ok("admin can manage autopilot", can("admin", "manage_autopilot"));
ok("member can source", can("member", "source"));
ok("member can outreach", can("member", "outreach"));
ok("member CANNOT manage keys", !can("member", "manage_keys"));
ok("member CANNOT manage settings", !can("member", "manage_settings"));
ok("member CANNOT manage fleet", !can("member", "manage_fleet"));
ok("viewer can view", can("viewer", "view"));
ok("viewer CANNOT source", !can("viewer", "source"));
ok("viewer CANNOT outreach", !can("viewer", "outreach"));
ok("viewer CANNOT manage anything", !can("viewer", "manage_keys") && !can("viewer", "manage_fleet"));

/* ---- API key format validation ---- */
ok("valid Anthropic key", validateApiKeyFormat("Anthropic", "sk-ant-" + "a".repeat(30)).valid);
ok("Anthropic key without prefix rejected", !validateApiKeyFormat("Anthropic", "abc123").valid);
ok("valid OpenAI key", validateApiKeyFormat("OpenAI", "sk-" + "b".repeat(30)).valid);
ok("valid Resend key", validateApiKeyFormat("Resend", "re_" + "c".repeat(20)).valid);
ok("valid SendGrid key", validateApiKeyFormat("SendGrid", "SG." + "d".repeat(30)).valid);
ok("valid Apify key", validateApiKeyFormat("Apify", "apify_api_" + "e".repeat(30)).valid);
ok("malformed Apify key rejected", !validateApiKeyFormat("Apify", "apify_" + "f".repeat(5)).valid);
ok("empty key rejected", !validateApiKeyFormat("OpenAI", "").valid);
ok("custom: short rejected", !validateApiKeyFormat("Custom", "abc").valid);
ok("custom: long accepted", validateApiKeyFormat("Custom", "abcdefghij").valid);

/* ---- last4 masking ---- */
ok("last4 of a key", last4Of("sk-ant-abcd1234") === "1234");
ok("last4 of short value", last4Of("ab") === "••••");

console.log(`RESULT rbac-keys: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
