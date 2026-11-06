const DEFAULT_ARIA_URL = "http://localhost:3000";
const $ = (id) => document.getElementById(id);
let previousUnread = null;

function ago(ms) {
  if (!ms) return null;
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function setCheck(id, tone, text) {
  const el = $(id);
  el.className = `check ${tone}`;
  el.querySelector(".value").textContent = text;
}

async function load() {
  const stored = await chrome.storage.local.get(["ariaUrl", "token", "autoOpenTab", "status"]);
  const liAt = await chrome.cookies.get({ url: "https://www.linkedin.com", name: "li_at" });
  return { ...stored, status: stored.status || {}, signedIn: Boolean(liAt) };
}

function render(data) {
  const { status, token, signedIn } = data;
  const name = status.account && status.account.displayName;

  setCheck("check-linkedin", signedIn ? "ok" : "warn", signedIn ? "Signed in" : "Not signed in: open linkedin.com");

  if (!token) setCheck("check-aria", "warn", "Not connected: ARIA › LinkedIn › Connect");
  else if (status.state === "error") setCheck("check-aria", "err", "Connection problem");
  else if (status.state === "pairing" || (!name && status.running)) setCheck("check-aria", "busy", "Connecting…");
  else setCheck("check-aria", "ok", name ? `Connected as ${name}` : "Paired");

  const last = ago(status.lastPollAt);
  if (status.running) setCheck("check-sync", "busy", "Syncing with LinkedIn…");
  else if (!token) setCheck("check-sync", "", "Waiting for pairing");
  else if (last) setCheck("check-sync", status.state === "error" ? "warn" : "ok", `Last sync ${last}`);
  else setCheck("check-sync", "", "Not synced yet");

  const live = Boolean(token) && status.state === "connected" && status.lastPollAt && Date.now() - status.lastPollAt < 90000;
  $("live").hidden = !live;

  const stats = status.stats;
  const unread = stats ? stats.unread : null;
  const unreadEl = $("unread");
  unreadEl.textContent = unread === null || unread === undefined ? "–" : String(unread);
  if (previousUnread !== null && unread > previousUnread) {
    unreadEl.classList.remove("bump");
    void unreadEl.offsetWidth;
    unreadEl.classList.add("bump");
  }
  previousUnread = unread ?? null;
  $("sent").textContent = stats ? String(stats.sentLast24h) : "–";
  $("cap").textContent = stats ? ` / ${stats.dailySendCap}` : "";
  $("meter").style.transform = `scaleX(${stats && stats.dailySendCap ? Math.min(1, stats.sentLast24h / stats.dailySendCap) : 0})`;

  const alert = $("alert");
  alert.hidden = !status.message;
  alert.textContent = status.message || "";

  const sync = $("sync");
  sync.disabled = !token || Boolean(status.running);
  sync.querySelector(".spinner").hidden = !status.running;
  sync.querySelector(".sync-label").textContent = status.running ? "Syncing…" : "Sync now";
}

async function refresh() {
  render(await load());
}

async function init() {
  $("version").textContent = chrome.runtime.getManifest().version;
  const data = await load();
  $("ariaUrl").value = data.ariaUrl || DEFAULT_ARIA_URL;
  $("token").value = data.token || "";
  $("autoOpenTab").checked = data.autoOpenTab !== false;
  render(data);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.status || changes.token)) void refresh();
  });
  setInterval(() => void refresh(), 1000);
}

$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const raw = $("ariaUrl").value.trim().replace(/\/+$/, "") || DEFAULT_ARIA_URL;
  let origin;
  try {
    origin = new URL(raw).origin;
  } catch {
    $("alert").hidden = false;
    $("alert").textContent = "That ARIA address is not a URL.";
    return;
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local) {
    if (!origin.startsWith("https://")) {
      $("alert").hidden = false;
      $("alert").textContent = "Use https:// for a remote ARIA.";
      return;
    }
    // Remote ARIA: ask for that one host only (needs this click).
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      $("alert").hidden = false;
      $("alert").textContent = "Permission for that ARIA address was refused.";
      return;
    }
  }
  await chrome.storage.local.set({ ariaUrl: origin, token: $("token").value.trim(), autoOpenTab: $("autoOpenTab").checked });
  await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
  await refresh();
});

$("sync").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "sync-now" }).catch(() => undefined);
  await refresh();
});

$("open").addEventListener("click", async () => {
  const { ariaUrl } = await chrome.storage.local.get("ariaUrl");
  const base = (ariaUrl || DEFAULT_ARIA_URL).replace(/\/+$/, "");
  const [existing] = await chrome.tabs.query({ url: `${base}/linkedin*` }).catch(() => []);
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${base}/linkedin` });
  }
  window.close();
});

void init();
