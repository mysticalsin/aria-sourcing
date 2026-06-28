/* ============================================================================
   tests/log-redact.mts
   Area: log redaction (src/lib/log-redact.ts).

   Audit finding: candidate emails and provider request/response bodies were
   logged in cleartext. These tests prove the scrubbers mask emails, bearer
   tokens, provider API keys, JWTs, AWS key ids and long secrets before anything
   reaches a log sink — and that no raw secret fragment survives.
   ========================================================================== */

import { redactEmail, redactSecrets, redactObject, safeLog } from "../src/lib/log-redact";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* ---- redactEmail ---- */
ok("masks the email local part, keeps domain", redactEmail("jane.doe@acme.com") === "j***@acme.com");
ok("no raw local part leaks", !redactEmail("alice@example.io").includes("alice"));
ok("domain stays greppable", redactEmail("ping j.smith@mantu.com please").includes("@mantu.com"));
ok("masks every email in the string", redactEmail("a@x.com and b@y.com") === "a***@x.com and b***@y.com");
ok("text with no email is unchanged", redactEmail("no address here") === "no address here");

/* ---- redactSecrets ---- */
ok("masks a Bearer token (keeps scheme)", redactSecrets("Authorization: Bearer abc123def456ghi") === "Authorization: Bearer ***");
ok("masks a Basic credential", redactSecrets("Basic dXNlcjpwYXNzd29yZA") === "Basic ***");
ok("masks a provider sk- key", (() => { const o = redactSecrets("key=sk-abcdef123456"); return o.includes("sk-***") && !o.includes("abcdef123456"); })());
ok("masks a JWT", redactSecrets("token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2") === "token ***");
ok("masks an AWS access key id", redactSecrets("AKIAIOSFODNN7EXAMPLE") === "***");
ok("masks a long hex secret", redactSecrets("sig=" + "a".repeat(40)) === "sig=***");
ok("plain text is untouched", redactSecrets("hello world 123") === "hello world 123");

/* ---- redactObject (shallow) ---- */
const original = {
  email: "jane@acme.com",
  apiKey: "sk-supersecret123456",
  token: "Bearer xyz",
  password: "hunter2hunter2",
  name: "Jane",
  count: 7,
};
const masked = redactObject(original);
ok("apiKey value masked", masked.apiKey === "***");
ok("token value masked", masked.token === "***");
ok("password value masked", masked.password === "***");
ok("email value keeps its shape", masked.email === "j***@acme.com");
ok("non-sensitive key (name) untouched", masked.name === "Jane");
ok("non-sensitive key (count) untouched", masked.count === 7);
ok("redactObject does not mutate the original", original.apiKey === "sk-supersecret123456" && original.token === "Bearer xyz");

/* ---- safeLog (deep) ---- */
const logs: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => {
  logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
};
try {
  safeLog("user jane@acme.com with Bearer abc123def456ghi", {
    apiKey: "sk-deadbeefcafe123456",
    nested: { email: "bob@x.io" },
  });
} finally {
  console.log = realLog;
}
const line = logs[0] ?? "";
ok("safeLog redacts email in a string arg", line.includes("j***@acme.com"));
ok("safeLog redacts bearer token in a string arg", line.includes("Bearer ***"));
ok("safeLog deep-redacts a sensitive object key", line.includes('"apiKey":"***"'));
ok("safeLog deep-redacts a nested email value", line.includes("b***@x.io"));
ok("safeLog leaks no raw secret fragment", !line.includes("deadbeef") && !line.includes("abc123def456"));

console.log(`RESULT log-redact: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
