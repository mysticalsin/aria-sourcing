// ARIA LinkedIn Bridge — service worker.
//
// Every minute (and right away when ARIA asks): ask ARIA what to do (poll),
// run each task as a plain fetch inside a www.linkedin.com tab of this
// browser (the user's own session, IP and browser), and post LinkedIn's raw
// answer back to ARIA. ARIA parses it.
//
// What never leaves this browser: the li_at session cookie and the
// JSESSIONID value. ARIA only learns whether a LinkedIn session exists.
// Every request ARIA asks for is checked against allowlist.js first.

import { LINKEDIN_ORIGIN, checkLinkedInRequest } from "./allowlist.js";
import { parseCapturedQuery } from "./queries.js";

const VERSION = chrome.runtime.getManifest().version;
const ALARM = "aria-linkedin-poll";
const DEFAULT_ARIA_URL = "http://localhost:3000";
// At most 4 polls x 2 thread refreshes per cycle: a first sync of the inbox
// spreads over a few minutes instead of a burst.
const MAX_POLLS_PER_CYCLE = 4;
const MAX_RESPONSE_CHARS = 3000000;
const TAB_LOAD_TIMEOUT_MS = 30000;
const QUERY_NAMES = ["messengerConversations", "messengerMessages"];
const MAX_QUERIES_PER_NAME = 6;
const PAIRING_TOKEN = /^aria_lnb_[A-Za-z0-9_-]{43}$/;
/** The ARIA page pings every 15 s while visible; it counts as open for 45 s. */
const LIVE_WINDOW_MS = 45000;
const LIVE_POLL_GAP_MS = 12000;
const ACTIVITY_MIN_GAP_MS = 15000;
const MIN_CYCLE_GAP_MS = 1500;
const REMOTE_SCRIPT_ID = "aria-page-remote";

// ── Settings and status ─────────────────────────────────────────────────────

async function settings() {
  const stored = await chrome.storage.local.get(["ariaUrl", "token", "autoOpenTab"]);
  return {
    ariaUrl: String(stored.ariaUrl || DEFAULT_ARIA_URL).replace(/\/+$/, ""),
    token: String(stored.token || ""),
    autoOpenTab: stored.autoOpenTab !== false,
  };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function ariaOrigin() {
  return originOf((await settings()).ariaUrl);
}

/** What the ARIA page and the popup may know: never the pairing code. */
async function publicStatus() {
  const [{ status = {} }, cfg] = await Promise.all([chrome.storage.local.get("status"), settings()]);
  return {
    version: VERSION,
    paired: Boolean(cfg.token),
    state: status.state || "idle",
    running: Boolean(status.running),
    message: status.message || "",
    sessionPresent: Boolean(status.sessionPresent),
    accountName: (status.account && status.account.displayName) || null,
    lastPollAt: status.lastPollAt || null,
    lastRunAt: status.lastRunAt || null,
    stats: status.stats || null,
  };
}

async function broadcastStatus() {
  const origin = await ariaOrigin();
  if (!origin) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: `${origin}/*` });
  } catch {
    return; // no host permission for that origin
  }
  if (!tabs.length) return;
  const status = await publicStatus();
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "status", status }).catch(() => undefined);
}

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({ status: { ...status, ...patch, updatedAt: Date.now() } });
  await broadcastStatus();
}

async function setBadge(state, unread) {
  try {
    if (state === "error") {
      await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
      await chrome.action.setBadgeText({ text: "!" });
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: "#6600AE" });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    await chrome.action.setBadgeText({ text: unread > 0 ? (unread > 99 ? "99+" : String(unread)) : "" });
  } catch {
    // badge is cosmetic
  }
}

// ── GraphQL query ids used by LinkedIn's own web app ───────────────────────
// LinkedIn rotates these ids. Watching the requests its messaging page makes
// keeps ARIA on the current ones (reported to ARIA on each poll).

async function captureQuery(url) {
  const captured = parseCapturedQuery(url);
  if (!captured) return;
  const { name, queryId, variables } = captured;
  const { queries = {} } = await chrome.storage.local.get("queries");
  const list = Array.isArray(queries[name]) ? queries[name] : [];
  const key = (q) => `${q.queryId}|${[...q.variables].sort().join(",")}`;
  const entry = { queryId, variables };
  if (list.length && key(list[0]) === key(entry)) return;
  const next = [entry, ...list.filter((q) => key(q) !== key(entry))].slice(0, MAX_QUERIES_PER_NAME);
  await chrome.storage.local.set({ queries: { ...queries, [name]: next } });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void captureQuery(details.url);
  },
  { urls: [`${LINKEDIN_ORIGIN}/voyager/api/voyagerMessagingGraphQL/*`] },
);

async function capturedQueries() {
  const { queries = {} } = await chrome.storage.local.get("queries");
  const out = {};
  for (const name of QUERY_NAMES) if (Array.isArray(queries[name])) out[name] = queries[name];
  return out;
}

// ── LinkedIn session and tab ────────────────────────────────────────────────

async function linkedInSession() {
  const [liAt, jsession] = await Promise.all([
    chrome.cookies.get({ url: LINKEDIN_ORIGIN, name: "li_at" }),
    chrome.cookies.get({ url: LINKEDIN_ORIGIN, name: "JSESSIONID" }),
  ]);
  return {
    present: Boolean(liAt && liAt.value),
    csrf: jsession && jsession.value ? jsession.value.replace(/^"|"$/g, "") : null,
  };
}

function waitForTab(tabId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, TAB_LOAD_TIMEOUT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function linkedInTab(autoOpen) {
  const tabs = await chrome.tabs.query({ url: `${LINKEDIN_ORIGIN}/*` });
  const usable = tabs.find((t) => t.status === "complete" && !t.discarded) || tabs.find((t) => !t.discarded);
  if (usable) {
    if (usable.status !== "complete") await waitForTab(usable.id);
    return usable.id;
  }
  if (!autoOpen) return null;
  // Opening the messaging page also lets the query-id watcher see the ids
  // LinkedIn currently uses.
  const tab = await chrome.tabs.create({ url: `${LINKEDIN_ORIGIN}/messaging/`, active: false, pinned: true });
  return (await waitForTab(tab.id)) ? tab.id : null;
}

/** Runs inside the LinkedIn tab (isolated world): a same-origin fetch. */
async function fetchInPage(origin, request, csrf, maxChars) {
  try {
    const response = await fetch(origin + request.path, {
      method: request.method,
      headers: { ...(request.headers || {}), "csrf-token": csrf },
      body: request.method === "POST" ? request.body : undefined,
      credentials: "include",
    });
    const text = await response.text();
    if (text.length > maxChars) {
      return { status: response.status, body: "", finalUrl: response.url, error: "LinkedIn answer too large to relay." };
    }
    return { status: response.status, body: text, finalUrl: response.url, error: null };
  } catch (err) {
    return { status: 0, body: "", finalUrl: null, error: String((err && err.message) || err).slice(0, 300) };
  }
}

async function runTask(task, session, cfg) {
  const refused = checkLinkedInRequest(task && task.request);
  if (refused) return { status: 0, body: "", finalUrl: null, error: `Refused by the extension: ${refused}` };
  if (!session.csrf) return { status: 0, body: "", finalUrl: null, error: "No LinkedIn session in this browser." };
  const tabId = await linkedInTab(cfg.autoOpenTab);
  if (tabId === null) {
    return { status: 0, body: "", finalUrl: null, error: "No LinkedIn tab available. Open linkedin.com in this browser." };
  }
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: fetchInPage,
      args: [LINKEDIN_ORIGIN, task.request, session.csrf, MAX_RESPONSE_CHARS],
    });
    return (injection && injection.result) || { status: 0, body: "", finalUrl: null, error: "The LinkedIn tab did not answer." };
  } catch (err) {
    return { status: 0, body: "", finalUrl: null, error: `Could not run in the LinkedIn tab: ${String((err && err.message) || err).slice(0, 200)}` };
  }
}

// ── ARIA ────────────────────────────────────────────────────────────────────

class AriaError extends Error {}

async function aria(cfg, path, body) {
  let response;
  try {
    response = await fetch(cfg.ariaUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AriaError(`ARIA is not reachable at ${cfg.ariaUrl}.`);
  }
  const json = await response.json().catch(() => ({}));
  if (response.status === 401) throw new AriaError("ARIA does not know this pairing code any more. Connect again from the ARIA LinkedIn page.");
  if (response.status === 404 && json.error === "linkedin_bridge_disabled") {
    throw new AriaError("The LinkedIn bridge is turned off on this ARIA server (LINKEDIN_BRIDGE_ENABLED).");
  }
  if (!response.ok || json.ok !== true) throw new AriaError(json.error || `ARIA answered HTTP ${response.status}.`);
  return json;
}

// ── Cycle ───────────────────────────────────────────────────────────────────

let running = false;
let rerun = false;
let scheduled = false;
let lastCycleAt = 0;
let liveUntil = 0;
let activityPending = false;
let lastActivityAt = 0;

/** Run a cycle as soon as possible, without overlapping or bursting. */
function requestCycle() {
  if (running) {
    rerun = true;
    return;
  }
  if (scheduled) return;
  scheduled = true;
  const wait = Math.max(0, lastCycleAt + MIN_CYCLE_GAP_MS - Date.now());
  setTimeout(() => {
    scheduled = false;
    void cycle();
  }, wait);
}

async function cycle() {
  if (running) return;
  running = true;
  lastCycleAt = Date.now();
  try {
    const cfg = await settings();
    if (!cfg.token) {
      await setStatus({ state: "unpaired", message: "Open the LinkedIn page in ARIA and click Connect." });
      await setBadge("unpaired", 0);
      return;
    }
    const session = await linkedInSession();
    await setStatus({ running: true, sessionPresent: session.present });
    let ran = 0;
    for (let i = 0; i < MAX_POLLS_PER_CYCLE; i += 1) {
      const poll = await aria(cfg, "/api/linkedin/bridge/poll", {
        extensionVersion: VERSION,
        sessionPresent: session.present,
        live: Date.now() < liveUntil,
        activity: activityPending,
        queries: await capturedQueries(),
      });
      activityPending = false;
      const state = session.present ? "connected" : "no-session";
      await setStatus({
        state,
        message: poll.account && poll.account.lastError ? poll.account.lastError : "",
        account: poll.account || null,
        stats: poll.stats || null,
        lastPollAt: Date.now(),
      });
      await setBadge(poll.account && poll.account.lastError ? "error" : state, (poll.stats && poll.stats.unread) || 0);
      const tasks = Array.isArray(poll.tasks) ? poll.tasks : [];
      if (!tasks.length) break;
      let stop = false;
      for (const task of tasks) {
        const answer = await runTask(task, session, cfg);
        await aria(cfg, "/api/linkedin/bridge/result", { taskId: task.id, op: task.op, ref: task.ref ?? null, ...answer });
        ran += 1;
        // Any failure ends the cycle; ARIA decides when to try again.
        if (answer.error || answer.status < 200 || answer.status >= 300) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
    if (ran) await setStatus({ lastRunAt: Date.now(), lastRunTasks: ran });
  } catch (err) {
    await setStatus({ state: "error", message: err instanceof AriaError ? err.message : String((err && err.message) || err) });
    await setBadge("error", 0);
  } finally {
    running = false;
    await setStatus({ running: false }).catch(() => undefined);
    if (rerun) {
      rerun = false;
      requestCycle();
    }
  }
}

// ── Messages from the popup, the ARIA page and the LinkedIn tab ─────────────

async function handleMessage(message, sender) {
  const fromTab = Boolean(sender.tab);
  const senderOrigin = originOf(sender.url || "");
  const fromAria = fromTab && senderOrigin !== null && senderOrigin === (await ariaOrigin());
  switch (message.type) {
    case "sync-now":
      // The popup (an extension page) or the configured ARIA page.
      if (fromTab && !fromAria) return { ok: false };
      requestCycle();
      return { ok: true };
    case "page-status":
      if (!fromAria) return { ok: false };
      return { ok: true, status: await publicStatus() };
    case "live":
      if (!fromAria) return { ok: false };
      liveUntil = Date.now() + LIVE_WINDOW_MS;
      if (!running && Date.now() - lastCycleAt > LIVE_POLL_GAP_MS) requestCycle();
      return { ok: true };
    case "pair":
      // One-click pairing: only from the ARIA address set in the extension.
      if (!fromAria) return { ok: false, error: "This page is not the ARIA address set in the extension." };
      if (typeof message.token !== "string" || !PAIRING_TOKEN.test(message.token)) return { ok: false, error: "Invalid pairing code." };
      await chrome.storage.local.set({ token: message.token });
      await setStatus({ state: "pairing", message: "", account: null, stats: null });
      requestCycle();
      return { ok: true };
    case "linkedin-activity":
      if (!fromTab || senderOrigin !== LINKEDIN_ORIGIN) return { ok: false };
      activityPending = true;
      if (Date.now() - lastActivityAt > ACTIVITY_MIN_GAP_MS) {
        lastActivityAt = Date.now();
        requestCycle();
      }
      return { ok: true };
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string" || sender.id !== chrome.runtime.id) return false;
  handleMessage(message, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

// ── A remote (https) ARIA needs the page script registered at runtime ───────

async function syncAriaContentScript() {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [REMOTE_SCRIPT_ID] });
    if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [REMOTE_SCRIPT_ID] });
    const origin = await ariaOrigin();
    if (!origin || !origin.startsWith("https://")) return;
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return;
    await chrome.scripting.registerContentScripts([
      { id: REMOTE_SCRIPT_ID, matches: [`${origin}/*`], js: ["aria-page.js"], runAt: "document_idle" },
    ]);
  } catch {
    // one-click pairing then needs the pairing code pasted by hand
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.ariaUrl) void syncAriaContentScript();
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
  void syncAriaContentScript();
});
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) requestCycle();
});
void ensureAlarm();
