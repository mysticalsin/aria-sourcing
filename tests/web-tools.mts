import { classifyFetchHost, assertPublicUrl } from "../src/lib/api/url";
import { WEB_TOOL_DEFS, isWebTool, stripHtml, runWebTool, BUILTIN_WEB_URL } from "../src/lib/ai/web-tools";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

/* -------- SSRF host classification (sync, offline, security-critical) -------- */
// Blocked: loopback, private RFC1918, CGNAT, link-local + cloud metadata, IPv6 loopback/ULA/link-local.
for (const h of [
  "127.0.0.1",
  "127.1.2.3",
  "10.0.0.5",
  "172.16.5.9",
  "172.31.255.255",
  "192.168.1.1",
  "100.64.0.1",
  "169.254.169.254", // AWS/GCP metadata
  "0.0.0.0",
  "::1",
  "fe80::1",
  "fc00::1",
  "fd12:3456::1",
  "ff02::1",
  "::ffff:7f00:1", // URL canonical form of ::ffff:127.0.0.1
  "::ffff:a00:1", // URL canonical form of ::ffff:10.0.0.1
  "::ffff:a9fe:a9fe", // URL canonical form of ::ffff:169.254.169.254
  "::7f00:1", // deprecated IPv4-compatible form of 127.0.0.1
  "64:ff9b::7f00:1", // NAT64 well-known prefix embedding 127.0.0.1
  "100:0:0:1::1", // IANA dummy IPv6 prefix
  "3fff::1", // IANA documentation prefix
  "5f00::1", // IANA SRv6 SID space, not globally reachable
  "2001:5::1", // IETF protocol-assignment space without a global exception
  "2001:40::1", // IETF protocol-assignment space without a global exception
  "2001:100::1", // IETF protocol-assignment space without a global exception
  "4000::1", // outside the currently allocated global-unicast 2000::/3 block
  "6000::1",
  "8000::1",
  "a000::1",
  "c000::1",
  "e000::1",
  "::ffff:5db8:d822", // IPv4-mapped literals are denied even when the embedded IPv4 is public
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "foo.internal",
  "db.local",
]) {
  ok(`blocks internal host ${h}`, classifyFetchHost(h) === "blocked");
}
// Public IP literals allowed.
for (const h of [
  "1.1.1.1",
  "8.8.8.8",
  "93.184.216.34",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2001:1::1",
  "2001:1::2",
  "2001:1::3",
  "2001:3::1",
  "2001:4:112::1",
  "2001:30::1",
]) {
  ok(`allows public IP literal ${h}`, classifyFetchHost(h) === "public");
}
// Public hostnames deferred to DNS resolution.
for (const h of ["example.com", "news.ycombinator.com", "www.google.com"]) {
  ok(`defers public hostname ${h} to DNS`, classifyFetchHost(h) === "needs-dns");
}

/* -------- assertPublicUrl (scheme / userinfo / literal-IP, no DNS needed) -------- */
ok("rejects non-http scheme", !(await assertPublicUrl("ftp://example.com")).ok);
ok("rejects file scheme", !(await assertPublicUrl("file:///etc/passwd")).ok);
ok("rejects embedded credentials", !(await assertPublicUrl("http://user:pass@example.com")).ok);
ok("rejects loopback literal", !(await assertPublicUrl("http://127.0.0.1/admin")).ok);
ok("rejects private literal", !(await assertPublicUrl("http://10.1.2.3/")).ok);
ok("rejects cloud metadata IP", !(await assertPublicUrl("http://169.254.169.254/latest/meta-data/")).ok);
ok("rejects ipv6 loopback", !(await assertPublicUrl("http://[::1]:8080/")).ok);
ok("rejects IPv4-mapped IPv6 loopback", !(await assertPublicUrl("http://[::ffff:127.0.0.1]/")).ok);
ok("rejects IPv4-mapped IPv6 private address", !(await assertPublicUrl("http://[::ffff:10.0.0.1]/")).ok);
ok("rejects IPv4-mapped IPv6 metadata address", !(await assertPublicUrl("http://[::ffff:169.254.169.254]/")).ok);
ok("rejects invalid url", !(await assertPublicUrl("not a url")).ok);
ok("allows public IP literal", (await assertPublicUrl("https://1.1.1.1/")).ok);
{
  const startedAt = Date.now();
  const timedOut = await assertPublicUrl("https://unresolved.example.test/", {
    lookupImpl: async () => await new Promise<never>(() => {}),
    timeoutMs: 20,
  });
  ok(
    "validation-only DNS preflight has an absolute timeout",
    timedOut.ok === false && /timed out/i.test(timedOut.reason ?? "") && Date.now() - startedAt < 250,
  );
}

/* -------- tool defs + dispatch contract -------- */
ok("exposes exactly 3 web tools", WEB_TOOL_DEFS.length === 3);
ok("web tool names", ["web_search", "fetch_page", "rss"].every((n) => isWebTool(n)));
ok("unknown tool is not a web tool", !isWebTool("send_email"));
ok("every def has an object input schema", WEB_TOOL_DEFS.every((t) => (t.inputSchema as { type?: string })?.type === "object"));
ok("builtin sentinel url is stable", BUILTIN_WEB_URL === "builtin:web-research");
// runWebTool must never throw and must refuse a blocked URL (SSRF) with ok:false.
const blocked = await runWebTool("fetch_page", { url: "http://127.0.0.1/" });
ok("fetch_page refuses loopback (SSRF)", blocked.ok === false && typeof blocked.error === "string");
const unknown = await runWebTool("definitely_not_a_tool", {});
ok("unknown web tool returns ok:false", unknown.ok === false);

/* -------- HTML stripping -------- */
const stripped = stripHtml(
  "<html><head><title>Hello &amp; World</title></head><body><script>bad()</script><p>Visible text.</p><style>x{}</style></body></html>",
);
ok("extracts + decodes title", stripped.title === "Hello & World");
ok("keeps visible text", stripped.text.includes("Visible text."));
ok("drops script contents", !stripped.text.includes("bad()"));
ok("drops style contents", !stripped.text.includes("x{}"));

const adversarialHtml = stripHtml(
  "<title>&amp;lt;safe&amp;gt;</title><body><script>hidden-script()</script data-extra><style>hidden-style{}</style data-extra><noscript>hidden-noscript</noscript\t data-extra><p>&amp;lt;b&amp;gt;</p></body>",
);
ok("decodes entities exactly once in titles", adversarialHtml.title === "&lt;safe&gt;");
ok("decodes entities exactly once in body text", adversarialHtml.text.includes("&lt;b&gt;"));
ok("drops script contents with a browser-tolerated closing tag", !adversarialHtml.text.includes("hidden-script()"));
ok("drops style contents with a browser-tolerated closing tag", !adversarialHtml.text.includes("hidden-style"));
ok("drops noscript contents with a browser-tolerated closing tag", !adversarialHtml.text.includes("hidden-noscript"));

console.log(`RESULT web-tools: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
