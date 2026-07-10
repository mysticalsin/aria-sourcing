/**
 * Integration test against a REAL Obscura sidecar. Not part of `npm test` --
 * run separately via `npm run test:obscura` once the sidecar is reachable
 * (`docker compose up -d obscura` locally, or the CI service container in m9).
 * Skips gracefully (exit 0) if no sidecar is reachable, so it never breaks a
 * plain `npm test` run or a machine without Docker.
 *
 * Two levels, deliberately:
 *  - Adapter-level (bypasses browser-tools.ts's SSRF guard on purpose): proves
 *    the real CDP round-trip -- navigate, click, re-read DOM -- works. Uses a
 *    `data:` URL fixture instead of a local HTTP server so this needs no
 *    cross-container networking between the test runner and the sidecar
 *    container (whichever one is running the sidecar can decode the data: URL
 *    itself; nothing needs to fetch it over the network). The SSRF guard is
 *    unit-tested on its own merits in tests/web-tools.mts and tests/browser-tools.mts;
 *    this test's job is the sidecar integration, not guard coverage.
 *  - Tool-level (through the full guarded runBrowserTool path): proves SSRF +
 *    robots.txt + the restricted vocabulary + session lifecycle all work
 *    together against a real, stable public page.
 */
import { openObscuraSession, closeObscuraSession } from "../src/lib/ai/obscura-adapter";
import { runBrowserTool } from "../src/lib/ai/browser-tools";
import { ensureObscuraRunning } from "../src/lib/ai/obscura-launcher";

let pass = 0,
  fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL:", name, extra ?? "");
  }
}

const OBSCURA_HTTP_URL = process.env.OBSCURA_URL || "http://127.0.0.1:9222";

async function sidecarReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OBSCURA_HTTP_URL}/json/version`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

const FIXTURE_HTML = `<!doctype html>
<html><body>
<ul id="list"><li>Item 1</li></ul>
<button id="load-more">Load more</button>
<script>
let n = 2;
document.getElementById("load-more").addEventListener("click", () => {
  const li = document.createElement("li");
  li.textContent = "Item " + n;
  n += 1;
  document.getElementById("list").appendChild(li);
});
</script>
</body></html>`;

async function adapterLevelTest() {
  const session = await openObscuraSession();
  try {
    const dataUrl = `data:text/html,${encodeURIComponent(FIXTURE_HTML)}`;
    await session.page.goto(dataUrl, { waitUntil: "load", timeout: 15_000 });

    const initialCount = await session.page.locator("#list li").count();
    ok("fixture starts with 1 item", initialCount === 1, initialCount);

    // Playwright's page.click() hangs against Obscura's lighter-weight CDP Input
    // domain (see browser-tools.ts's click case) -- use the same element.click()
    // evaluate approach the production code actually uses.
    await session.page.evaluate(() => (document.querySelector("#load-more") as HTMLElement)?.click());
    await session.page.waitForFunction(() => document.querySelectorAll("#list li").length === 2, { timeout: 5_000 });

    const afterClickCount = await session.page.locator("#list li").count();
    ok("clicking load-more appends a new item", afterClickCount === 2, afterClickCount);

    const lastItemText = await session.page.locator("#list li").last().textContent();
    ok("the new item has the expected text", lastItemText === "Item 2", lastItemText);

  } finally {
    await closeObscuraSession(session.id);
  }
}

async function toolLevelTest() {
  const openResult = await runBrowserTool("browser_open", { url: "https://example.com" });
  ok("browser_open succeeds through the full guarded path", openResult.ok === true, openResult);
  const sessionId = (openResult.content as { sessionId?: string } | undefined)?.sessionId;
  if (!sessionId) return;

  const actResult = await runBrowserTool("browser_act", { sessionId, type: "scroll", direction: "down" });
  ok("browser_act scroll succeeds", actResult.ok === true, actResult);

  // example.com has one real link ("More information...") -- click it through the
  // full guarded path (dispatch -> click -> post-navigation SSRF+robots recheck).
  const clickResult = await runBrowserTool("browser_act", { sessionId, type: "click", selector: "a" });
  ok("browser_act click navigates via the real link", clickResult.ok === true, clickResult);
  ok(
    "the click actually navigated away from example.com",
    typeof (clickResult.content as { url?: string } | undefined)?.url === "string" &&
      !(clickResult.content as { url?: string }).url!.includes("example.com"),
    clickResult,
  );

  const extractResult = await runBrowserTool("browser_extract", { sessionId });
  ok(
    "browser_extract returns a non-empty title after navigating",
    typeof (extractResult.content as { title?: string } | undefined)?.title === "string" &&
      (extractResult.content as { title?: string }).title!.length > 0,
    extractResult,
  );

  const closeResult = await runBrowserTool("browser_close", { sessionId });
  ok("browser_close succeeds", closeResult.ok === true, closeResult);
}

async function main() {
  const isLocal = OBSCURA_HTTP_URL.includes("127.0.0.1") || OBSCURA_HTTP_URL.includes("localhost");
  if (isLocal) {
    try {
      await ensureObscuraRunning();
    } catch (e) {
      console.warn("[Test] Failed to ensure local Obscura sidecar is running:", e);
    }
  }

  if (!(await sidecarReachable())) {
    console.log(`SKIPPED: no Obscura sidecar reachable at ${OBSCURA_HTTP_URL} (run \`docker compose up -d obscura\` first)`);
    process.exit(0);
  }

  await adapterLevelTest();
  await toolLevelTest();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("TEST CRASHED:", err);
  process.exit(1);
});
