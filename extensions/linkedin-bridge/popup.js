const DEFAULT_ARIA_URL = "http://localhost:3000";
const $ = (id) => document.getElementById(id);

function ago(ms) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function setLine(el, text, tone) {
  el.textContent = text;
  el.className = tone || "";
}

async function render() {
  const { ariaUrl, token, autoOpenTab, status = {} } = await chrome.storage.local.get(["ariaUrl", "token", "autoOpenTab", "status"]);
  $("ariaUrl").value = ariaUrl || DEFAULT_ARIA_URL;
  $("token").value = token || "";
  $("autoOpenTab").checked = autoOpenTab !== false;

  const liAt = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "li_at" });
  setLine($("session"), liAt ? "LinkedIn: signed in in this browser" : "LinkedIn: not signed in (open linkedin.com)", liAt ? "ok" : "warn");

  const name = status.account && status.account.displayName;
  const states = {
    connected: [`Paired with ARIA${name ? ` as ${name}` : ""}`, "ok"],
    "no-session": ["Paired, waiting for a LinkedIn session", "warn"],
    unpaired: ["Not paired yet", "warn"],
    error: ["Problem", "err"],
  };
  const [label, tone] = states[status.state] || ["Waiting for the first sync", ""];
  setLine($("state"), label, tone);
  const parts = [];
  if (status.message) parts.push(status.message);
  parts.push(`Last contact with ARIA: ${ago(status.lastPollAt)}`);
  $("detail").textContent = parts.join(" · ");
}

$("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  let ariaUrl = $("ariaUrl").value.trim().replace(/\/+$/, "") || DEFAULT_ARIA_URL;
  let origin;
  try {
    origin = new URL(ariaUrl).origin;
  } catch {
    setLine($("state"), "That ARIA address is not a URL.", "err");
    return;
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local) {
    if (!origin.startsWith("https://")) {
      setLine($("state"), "Use https:// for a remote ARIA.", "err");
      return;
    }
    // Remote ARIA: ask for that one host only (user gesture required).
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      setLine($("state"), "Permission for that ARIA address was refused.", "err");
      return;
    }
  }
  ariaUrl = origin;
  await chrome.storage.local.set({
    ariaUrl,
    token: $("token").value.trim(),
    autoOpenTab: $("autoOpenTab").checked,
  });
  await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
  await render();
});

$("sync").addEventListener("click", async () => {
  setLine($("state"), "Syncing…", "");
  await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
  await render();
});

$("open").addEventListener("click", async () => {
  const { ariaUrl } = await chrome.storage.local.get("ariaUrl");
  await chrome.tabs.create({ url: `${ariaUrl || DEFAULT_ARIA_URL}/linkedin` });
});

void render();
