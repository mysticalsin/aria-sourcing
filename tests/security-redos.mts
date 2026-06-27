import { parseEmailAndJD, classifyReply } from "../src/lib/mock-ai";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

// --- ReDoS / event-loop DoS guard ---
const hostile = "key required skills " + "a".repeat(300000) + "@" + "b".repeat(300);
let elapsed = 0;
let threw = false;
try {
  const t0 = Date.now();
  parseEmailAndJD({ email: hostile });
  elapsed = Date.now() - t0;
} catch {
  threw = true;
}
ok("hostile ~300KB input does not throw", !threw);
ok(`hostile input parses fast (was ${elapsed}ms, must be < 1000ms)`, elapsed < 1000);

let threw2 = false;
try {
  parseEmailAndJD({ email: "x".repeat(500000), jd: "y".repeat(500000) });
} catch {
  threw2 = true;
}
ok("500KB x2 input handled without throw", !threw2);

// --- classifyReply compliance / no-false-positive ---
ok("erasure question -> NEGATIVE", classifyReply("Can you delete my data?").intent === "NEGATIVE");
ok("'take me off your list' -> NEGATIVE", classifyReply("Please take me off your list.").intent === "NEGATIVE");
ok(
  "decline ending in a question -> NOT_INTERESTED",
  classifyReply("Thanks, but this isn't for me right now. Anything else?").intent === "NOT_INTERESTED",
);
ok(
  "bare keyword-less question -> not QUALIFIED_INTEREST",
  classifyReply("Hmm, who is this exactly?").intent !== "QUALIFIED_INTEREST",
);
ok(
  "salary question still -> QUALIFIED_INTEREST",
  classifyReply("what is the salary and is it remote?").intent === "QUALIFIED_INTEREST",
);
ok("clear interest still -> INTERESTED", classifyReply("Yes, I'd love to talk — when works?").intent === "INTERESTED");

console.log(`RESULT security-redos: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
