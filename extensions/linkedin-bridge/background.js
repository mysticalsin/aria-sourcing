// ARIA LinkedIn Bridge — service worker.
//
// Every minute: ask ARIA what to do (poll), run each task as a plain fetch
// inside a www.linkedin.com tab of this browser (the user's own session, IP
// and browser), and post LinkedIn's raw answer back to ARIA. ARIA parses it.
//
// What never leaves this browser: the li_at session cookie and the
// JSESSIONID value. ARIA only learns whether a LinkedIn session exists.
// Every request ARIA asks for is checked against allowlist.js first.

import { LINKEDIN_ORIGIN, checkLinkedInRequest } from "./allowlist.js";
import { parseCapturedQuery } from "./queries.js";

const VERSION = chrome.runtime.getManifest().version;
const ALARM = "aria-linkedin-poll";
const DEFAULT_ARIA_URL = "http://localhost:3000";
// At most 4 polls x 2 thread refreshes a minute: a first sync of the inbox
// spreads over a few minutes instead of a burst.
const MAX_POLLS_PER_CYCLE = 4;
const MAX_RESPONSE_CHARS = 3000000;
const TAB_LOAD_TIMEOUT_MS = 30000;
const QUERY_NAMES = ["messengerConversations", "messengerMessages"];
const MAX_QUERIES_PER_NAME = 6;

// ── Settings and status ─────────────────────────────────────────────────────

async function settings() {
  const stored = await chrome.storage.local.get(["ariaUrl", "token", "autoOpenTab"]);
  return {
    ariaUrl: String(stored.ariaUrl || DEFAULT_ARIA_URL).replace(/\/+$/, ""),
    token: String(stored.token || ""),
    autoOpenTab: stored.autoOpenTab !== false,
  };
}

async function setStatus(patch) {
  const { status = {} } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({ status: { ...status, ...patch, updatedAt: Date.now() } });
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
  if (response.status === 401) throw new AriaError("ARIA does not know this pairing code any more. Pair again from the ARIA LinkedIn page.");
  if (response.status === 404 && json.error === "linkedin_bridge_disabled") {
    throw new AriaError("The LinkedIn bridge is turned off on this ARIA server (LINKEDIN_BRIDGE_ENABLED).");
  }
  if (!response.ok || json.ok !== true) throw new AriaError(json.error || `ARIA answered HTTP ${response.status}.`);
  return json;
}

// ── Cycle ───────────────────────────────────────────────────────────────────

let running = false;

async function cycle() {
  if (running) return;
  running = true;
  try {
    const cfg = await settings();
    if (!cfg.token) {
      await setStatus({ state: "unpaired", message: "Paste the pairing code from ARIA (LinkedIn page)." });
      return;
    }
    const session = await linkedInSession();
    let ran = 0;
    for (let i = 0; i < MAX_POLLS_PER_CYCLE; i += 1) {
      const poll = await aria(cfg, "/api/linkedin/bridge/poll", {
        extensionVersion: VERSION,
        sessionPresent: session.present,
        queries: await capturedQueries(),
      });
      await setStatus({
        state: session.present ? "connected" : "no-session",
        message: poll.account && poll.account.lastError ? poll.account.lastError : "",
        account: poll.account || null,
        lastPollAt: Date.now(),
      });
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
  } finally {
    running = false;
  }
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => void ensureAlarm());
chrome.runtime.onStartup.addListener(() => void ensureAlarm());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void cycle();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "sync-now") {
    cycle().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
void ensureAlarm();
