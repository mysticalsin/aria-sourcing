import { createHmac } from "node:crypto";
import { demoAuthConfigured, mintDemoToken, verifyDemoToken } from "../src/lib/demo-auth";

/*
 * Target: src/lib/demo-auth.ts — the HMAC-SHA256 gate that decides whether an
 * anonymous demo visitor may spend the env-resident LLM key. `secret()` reads
 * process.env.DEMO_SESSION_SECRET fresh on every call (no module-level
 * caching), so these scenarios can mutate the env in-process without needing
 * a subprocess worker.
 */

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

/** Flip a single hex character to a different, still-valid hex character. */
function flipHexChar(c: string): string {
  return c === "0" ? "1" : "0";
}

// --- Happy path: mint -> verify round-trips under a configured secret ------
process.env.DEMO_SESSION_SECRET = SECRET_A;
ok("configured: secret >=16 chars reports configured", demoAuthConfigured());

const token = mintDemoToken();
ok("token has <expMs>.<hex-hmac> shape", /^\d+\.[0-9a-f]+$/.test(token));
ok("mint -> verify round-trips true under the same secret", verifyDemoToken(token));

// --- Tampered signature: flip one hex char of the HMAC -----------------
{
  const [exp, sig] = token.split(".");
  const tamperedSig = flipHexChar(sig[0]) + sig.slice(1);
  ok("tampered signature char -> verify fails", !verifyDemoToken(`${exp}.${tamperedSig}`));
}

// --- Tampered payload: change the expiry digits (still far in the future,
//     so this isolates signature-mismatch rejection from expiry rejection) --
{
  const [exp, sig] = token.split(".");
  const tamperedExp = String(Number(exp) + 2);
  ok("tampered payload (exp) -> verify fails", !verifyDemoToken(`${tamperedExp}.${sig}`));
}

// --- Cross-secret: a token minted under secret A must not verify under B ---
process.env.DEMO_SESSION_SECRET = SECRET_B;
ok("token minted under secret A fails verify under secret B", !verifyDemoToken(token));
process.env.DEMO_SESSION_SECRET = SECRET_A; // restore for the checks below

// --- Malformed tokens never throw, just fail closed -------------------------
ok("empty string token rejected", !verifyDemoToken(""));
ok("undefined token rejected", !verifyDemoToken(undefined));
ok("null token rejected", !verifyDemoToken(null));
ok("token without a separator rejected", !verifyDemoToken("nodotshere"));
ok("token with non-numeric exp rejected", !verifyDemoToken("notanumber.abcd1234"));

// --- Expiry: a correctly-signed but expired token must fail; an unexpired
//     one, freshly minted the same way, must succeed --------------------
{
  const pastExp = String(Date.now() - 60_000);
  const pastSig = createHmac("sha256", SECRET_A).update(pastExp).digest("hex");
  ok("expired-but-correctly-signed token -> verify fails", !verifyDemoToken(`${pastExp}.${pastSig}`));

  const futureExp = String(Date.now() + 60_000);
  const futureSig = createHmac("sha256", SECRET_A).update(futureExp).digest("hex");
  ok("unexpired correctly-signed token -> verify succeeds", verifyDemoToken(`${futureExp}.${futureSig}`));
}

// --- Fail-closed: secret unset ----------------------------------------------
delete process.env.DEMO_SESSION_SECRET;
ok("unset secret: demoAuthConfigured is false", !demoAuthConfigured());
ok("unset secret: a previously-valid token now fails verify", !verifyDemoToken(token));

const tokenMintedWithoutSecret = mintDemoToken();
ok(
  "unset secret: mint still returns an <exp>.<hex> shaped string (mint doesn't self-gate; caller must check demoAuthConfigured)",
  /^\d+\.[0-9a-f]+$/.test(tokenMintedWithoutSecret),
);
ok("unset secret: a token minted without a secret still fails verify (fails closed)", !verifyDemoToken(tokenMintedWithoutSecret));

// --- Secret present but too short (<16 chars): also treated as unconfigured -
process.env.DEMO_SESSION_SECRET = "short";
ok("short secret (<16 chars): demoAuthConfigured is false", !demoAuthConfigured());
ok("short secret: verify fails even for a token freshly minted under it", !verifyDemoToken(mintDemoToken()));

delete process.env.DEMO_SESSION_SECRET;

console.log(`RESULT demo-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
