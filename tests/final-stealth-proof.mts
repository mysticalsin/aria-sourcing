import { runBrowserTool } from "../src/lib/ai/browser-tools";

async function verifyStealthAndForms() {
  console.log("=========================================");
  console.log("   RUNNING FINAL STEALTH & FORM PROOF   ");
  console.log("=========================================");

  // Direct fetch check to see why it fails
  const robotsUrl = "https://httpbin.org/robots.txt";
  console.log(`[Test] Running direct fetch on ${robotsUrl}...`);
  try {
    const res = await fetch(robotsUrl, {
      method: "GET",
      headers: { accept: "text/plain", "user-agent": "Mozilla/5.0" },
      redirect: "manual"
    });
    console.log(`[Test] Direct fetch response status: ${res.status}`);
  } catch (err) {
    console.error("[Test] Direct fetch caught error:", err);
  }

  // 1. Open the browser session to httpbin
  console.log("[Test] Spawning sidecar and opening session to https://httpbin.org/headers...");
  const openRes = await runBrowserTool("browser_open", { url: "https://httpbin.org/headers" });
  if (!openRes.ok) {
    console.error("[Test] Open failed:", openRes.error);
    process.exit(1);
  }
  const sessionId = (openRes.content as any).sessionId;
  console.log(`[Test] Session opened successfully (ID: ${sessionId})`);

  try {
    // 2. Query HTTP headers via evaluate to see if User-Agent overrides took effect
    console.log("[Test] Evaluating document text (HTTP Headers context)...");
    const docText = (openRes.content as any).text || "";
    console.log(`[Test] Received headers response:\n${docText.slice(0, 400)}`);

    // 3. Verify navigator overrides
    console.log("[Test] Checking navigator.webdriver...");
    const webdriverRes = await runBrowserTool("browser_act", {
      sessionId,
      type: "evaluate",
      value: "navigator.webdriver"
    });
    console.log(`[Test] navigator.webdriver: ${(webdriverRes.content as any)?.result} (Expected: false)`);

    console.log("[Test] Checking navigator.userAgent...");
    const uaRes = await runBrowserTool("browser_act", {
      sessionId,
      type: "evaluate",
      value: "navigator.userAgent"
    });
    console.log(`[Test] navigator.userAgent: "${(uaRes.content as any)?.result}"`);

  } finally {
    // 5. Clean up session
    const closeRes = await runBrowserTool("browser_close", { sessionId });
    console.log(`[Test] Session closed successfully: ${closeRes.ok}`);
    console.log("=========================================");
  }
}

verifyStealthAndForms().catch(err => {
  console.error("PROOF RUN FAILED:", err);
  process.exit(1);
});
