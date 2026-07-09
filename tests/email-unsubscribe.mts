import {
  createEmailUnsubscribeLink,
  hashEmailUnsubscribeToken,
  isEmailUnsubscribeToken,
  renderEmailWithUnsubscribe,
} from "../src/lib/email-unsubscribe";
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

const originalBaseUrl = process.env.OUTREACH_UNSUBSCRIBE_BASE_URL;

try {
  process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = "https://aria.example.test";
  const link = createEmailUnsubscribeLink();
  ok("unsubscribe link is created from an HTTPS canonical base URL", link !== null);
  ok("unsubscribe token is opaque base64url", link !== null && /^[A-Za-z0-9_-]{43}$/.test(link.token));
  ok("unsubscribe token validator accepts generated tokens", link !== null && isEmailUnsubscribeToken(link.token));
  ok("unsubscribe hash is stable and non-reversible length", link !== null && hashEmailUnsubscribeToken(link.token) === link.tokenHash && /^[0-9a-f]{64}$/.test(link.tokenHash));
  ok("unsubscribe URL contains no recipient data", link !== null && !/candidate@|workspace|email/i.test(link.url));

  if (link) {
    const rendered = renderEmailWithUnsubscribe("Hello <candidate>", link.url);
    ok("email footer includes a visible unsubscribe URL", rendered.text.includes(link.url));
    ok("email HTML footer escapes message content", rendered.html.includes("Hello &lt;candidate&gt;"));
    ok("email carries a standard List-Unsubscribe header", rendered.headers["List-Unsubscribe"] === `<${link.url}>`);
    ok("email carries RFC 8058 one-click semantics", rendered.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
  }

  process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = "http://aria.example.test";
  ok("unsubscribe refuses insecure base URLs", createEmailUnsubscribeLink() === null);
  process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = "https://aria.example.test/?tenant=ws-1";
  ok("unsubscribe refuses base URLs with query data", createEmailUnsubscribeLink() === null);
  ok("unsubscribe rejects malformed tokens", !isEmailUnsubscribeToken("not-a-token"));
} finally {
  if (originalBaseUrl === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_BASE_URL;
  else process.env.OUTREACH_UNSUBSCRIBE_BASE_URL = originalBaseUrl;
}

const unsubscribeRoute = readFileSync(new URL("../src/app/api/unsubscribe/[token]/route.ts", import.meta.url), "utf8");
const unsubscribePage = readFileSync(new URL("../src/app/unsubscribe/[token]/page.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/app/app-shell.tsx", import.meta.url), "utf8");
const providers = readFileSync(new URL("../src/components/app/providers.tsx", import.meta.url), "utf8");
ok("unsubscribe POST hashes an opaque token before lookup", /hashEmailUnsubscribeToken\(token\)/.test(unsubscribeRoute));
ok("unsubscribe POST writes the existing suppression list", /from\("suppression_list"\)/.test(unsubscribeRoute));
ok("unsubscribe endpoint does not log recipient or token data", !/safeLog|console\./.test(unsubscribeRoute));
ok("unsubscribe page uses a form POST rather than GET mutation", /method="post"/.test(unsubscribePage));
ok("unsubscribe page is reachable without app chrome", /pathname\.startsWith\("\/unsubscribe"\)/.test(appShell));
ok("unsubscribe page is public in the session proxy", /path\.startsWith\("\/unsubscribe"\)/.test(proxy));
ok("unsubscribe page does not hydrate the authenticated workspace provider", /barePath/.test(providers));

console.log(`RESULT email-unsubscribe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
