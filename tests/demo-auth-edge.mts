import { createHmac } from "node:crypto";
import { mintDemoToken } from "../src/lib/demo-auth";
import { verifyDemoTokenAtEdge } from "../src/lib/demo-auth-edge";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const secret = "edge-demo-session-secret-32-characters";
process.env.DEMO_SESSION_SECRET = secret;
const token = mintDemoToken();

ok("Node-minted demo token verifies at the Edge", await verifyDemoTokenAtEdge(token, secret));
ok("forged demo token fails at the Edge", !(await verifyDemoTokenAtEdge("9999999999999." + "0".repeat(64), secret)));
ok("missing demo secret fails closed", !(await verifyDemoTokenAtEdge(token, "")));
ok("short demo secret fails closed", !(await verifyDemoTokenAtEdge(token, "short")));

const expiredAt = String(Date.now() - 1_000);
const expiredSig = createHmac("sha256", secret).update(expiredAt).digest("hex");
ok("expired signed token fails at the Edge", !(await verifyDemoTokenAtEdge(`${expiredAt}.${expiredSig}`, secret)));

delete process.env.DEMO_SESSION_SECRET;
console.log(`RESULT demo-auth-edge: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
