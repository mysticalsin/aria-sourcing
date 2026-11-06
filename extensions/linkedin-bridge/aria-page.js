// Content script on the ARIA web app. Relays between the /linkedin page
// (window.postMessage) and the extension's service worker:
//   page -> extension: hello, pair (one-click pairing), nudge (sync now),
//                      live (the inbox page is open and visible)
//   extension -> page: status (never the pairing code or any cookie)
// The service worker checks that this tab's origin is the ARIA address set
// in the extension before acting on anything relayed from here.
(() => {
  const FROM_PAGE = "aria-linkedin-page";
  const FROM_EXTENSION = "aria-linkedin-extension";
  const TOKEN = /^aria_lnb_[A-Za-z0-9_-]{43}$/;

  function toPage(message) {
    window.postMessage({ source: FROM_EXTENSION, ...message }, window.location.origin);
  }

  async function relay(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null; // extension reloaded or service worker unavailable
    }
  }

  async function announce() {
    const answer = await relay({ type: "page-status" });
    if (answer && answer.ok) toPage({ type: "status", status: answer.status });
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== FROM_PAGE || typeof data.type !== "string") return;
    switch (data.type) {
      case "hello":
        await announce();
        break;
      case "pair": {
        if (typeof data.token !== "string" || !TOKEN.test(data.token)) return;
        const answer = await relay({ type: "pair", token: data.token });
        toPage({ type: "paired", ok: Boolean(answer && answer.ok), error: (answer && answer.error) || null });
        await announce();
        break;
      }
      case "nudge":
        await relay({ type: "sync-now" });
        break;
      case "live":
        await relay({ type: "live" });
        break;
      default:
        break;
    }
  });

  // Pushed by the service worker whenever its status changes.
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "status") toPage({ type: "status", status: message.status });
  });

  void announce();
})();
