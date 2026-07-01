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
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "foo.internal",
  "db.local",
]) {
  ok(`blocks internal host ${h}`, classifyFetchHost(h) === "blocked");
}
// Public IP literals allowed.
for (const h of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) {
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
ok("rejects invalid url", !(await assertPublicUrl("not a url")).ok);
ok("allows public IP literal", (await assertPublicUrl("https://1.1.1.1/")).ok);

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

console.log(`RESULT web-tools: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
