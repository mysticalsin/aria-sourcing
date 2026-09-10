#!/usr/bin/env node
/**
 * OpenBot / AriaBot Chromium supervisor for Aria Fleet.
 *
 * 1 seat = 1 Chromium profile. Multiple tabs per seat.
 * Human Take control uses CDP screencast over WebSocket (fluid ~15–30 FPS)
 * instead of JPEG polling — GrokBot-like remote browser feel.
 *
 * Env:
 *   OPENBOT_SUPERVISOR_PORT / PORT
 *   SUPERVISOR_TOKEN, COMPUTER_TOKEN
 *   OPENBOT_HEADED=1
 *   OPENBOT_MAX_COMPUTERS
 *   OPENBOT_PROFILE_ROOT
 *   OPENBOT_PUBLIC_BASE
 *   OPENBOT_STREAM_QUALITY (default 55)
 *   OPENBOT_STREAM_MAX_WIDTH / OPENBOT_STREAM_MAX_HEIGHT
 *   OPENBOT_PROXY_SERVER / OPENBOT_PROXY_USERNAME / OPENBOT_PROXY_PASSWORD
 *   OPENBOT_LOCALE / OPENBOT_TIMEZONE / OPENBOT_STEALTH=0 to disable
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || process.env.OPENBOT_SUPERVISOR_PORT || 18765);
const SUPERVISOR_TOKEN = (process.env.SUPERVISOR_TOKEN || "aria-supervisor-dev").trim();
const COMPUTER_TOKEN = (process.env.COMPUTER_TOKEN || "aria-computer-dev").trim();
const HEADED = process.env.OPENBOT_HEADED === "1";
const MAX = Number(process.env.OPENBOT_MAX_COMPUTERS || 10);
const PROFILE_ROOT = process.env.OPENBOT_PROFILE_ROOT || "/tmp/aria-openbot/profiles";
const PUBLIC_BASE = (process.env.OPENBOT_PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const STREAM_QUALITY = Number(process.env.OPENBOT_STREAM_QUALITY || 55);
const STREAM_MAX_W = Number(process.env.OPENBOT_STREAM_MAX_WIDTH || 1400);
const STREAM_MAX_H = Number(process.env.OPENBOT_STREAM_MAX_HEIGHT || 900);
const CHROME_PATH =
  process.env.OPENBOT_CHROME_PATH ||
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/usr/local/bin/google-chrome";
/** Optional outbound proxy (Browserbase / Steel style sticky egress). */
const PROXY_SERVER = (process.env.OPENBOT_PROXY_SERVER || "").trim();
const PROXY_USER = (process.env.OPENBOT_PROXY_USERNAME || "").trim();
const PROXY_PASS = (process.env.OPENBOT_PROXY_PASSWORD || "").trim();
const LOCALE = (process.env.OPENBOT_LOCALE || "en-US").trim();
const TIMEZONE = (process.env.OPENBOT_TIMEZONE || "America/Montreal").trim();
const STEALTH = process.env.OPENBOT_STEALTH !== "0";

fs.mkdirSync(PROFILE_ROOT, { recursive: true });

/** @type {Map<string, any>} */
const computers = new Map();

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(raw),
    "access-control-allow-origin": "*",
  });
  res.end(raw);
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function computerTokenOk(req) {
  const header = req.headers["x-openbot-computer-token"];
  const tok = (typeof header === "string" ? header : "") || bearer(req);
  return tok === COMPUTER_TOKEN;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dwell(minMs = 120, maxMs = 420) {
  await sleep(randInt(minMs, maxMs));
}

function looksLikeLinkedInAuthWall(text, title = "", url = "") {
  const blob = `${url} ${title} ${text}`.toLowerCase();
  return (
    blob.includes("/login") ||
    blob.includes("authwall") ||
    blob.includes("checkpoint") ||
    blob.includes("sign in") ||
    blob.includes("join linkedin") ||
    blob.includes("enter the code") ||
    blob.includes("two-step") ||
    blob.includes("2fa") ||
    blob.includes("verify your identity") ||
    blob.includes("suspicious activity")
  );
}

function launchOptsBase() {
  const jitterW = 1400 + randInt(-24, 24);
  const jitterH = 900 + randInt(-16, 16);
  const opts = {
    headless: !HEADED,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      `--window-size=${jitterW},${jitterH}`,
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...(STEALTH
        ? [
            "--disable-features=IsolateOrigins,site-per-process",
            "--lang=" + LOCALE.replace("_", "-"),
          ]
        : []),
    ],
    viewport: { width: jitterW, height: jitterH },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: LOCALE,
    timezoneId: TIMEZONE,
    colorScheme: "light",
    deviceScaleFactor: 1,
  };
  if (PROXY_SERVER) {
    opts.proxy = {
      server: PROXY_SERVER,
      ...(PROXY_USER ? { username: PROXY_USER, password: PROXY_PASS } : {}),
    };
  }
  if (fs.existsSync(CHROME_PATH)) opts.executablePath = CHROME_PATH;
  return opts;
}

function viewUrl(botId) {
  return `${PUBLIC_BASE}/view/${encodeURIComponent(botId)}`;
}

function computerUrl(botId) {
  return `${PUBLIC_BASE}/c/${encodeURIComponent(botId)}`;
}

function registerPage(rec, page) {
  for (const [id, p] of rec.pages) {
    if (p === page) return id;
  }
  const id = `tab-${rec.nextTabSeq++}`;
  rec.pages.set(id, page);
  page.setDefaultTimeout(45_000);
  page.on("close", () => {
    rec.pages.delete(id);
    if (rec.activeTabId === id) {
      const next = rec.pages.keys().next();
      if (!next.done) {
        rec.activeTabId = next.value;
        rec.page = rec.pages.get(next.value);
        void restartScreencast(rec);
      }
    }
    broadcastTabs(rec);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      broadcastTabs(rec);
      broadcastMeta(rec);
    }
  });
  return id;
}

async function tabList(rec) {
  const out = [];
  for (const [id, page] of [...rec.pages.entries()]) {
    if (page.isClosed()) {
      rec.pages.delete(id);
      continue;
    }
    out.push({
      id,
      title: (await page.title().catch(() => "")) || "New tab",
      url: page.url(),
      active: id === rec.activeTabId,
    });
  }
  return out;
}

function sendAll(rec, obj) {
  const raw = JSON.stringify(obj);
  for (const ws of rec.streamClients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

function broadcastTabs(rec) {
  void tabList(rec).then((tabs) => sendAll(rec, { type: "tabs", tabs }));
}

function broadcastMeta(rec) {
  sendAll(rec, {
    type: "meta",
    control: rec.control,
    status: rec.status,
    activeTabId: rec.activeTabId,
    url: rec.page?.url?.() || "",
  });
}

async function stopScreencast(rec) {
  if (!rec.cdp) return;
  try { await rec.cdp.send("Page.stopScreencast"); } catch {}
  try { await rec.cdp.detach(); } catch {}
  rec.cdp = null;
  rec.streaming = false;
}

async function startScreencast(rec) {
  if (!rec.page || rec.page.isClosed()) return;
  if (rec.streamClients.size === 0) return;
  await stopScreencast(rec);
  try {
    const cdp = await rec.context.newCDPSession(rec.page);
    rec.cdp = cdp;
    cdp.on("Page.screencastFrame", async (frame) => {
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      } catch {}
      // Binary JPEG frames (Browserbase-style) — much lower WS overhead than base64 JSON.
      const jpeg = Buffer.from(frame.data, "base64");
      const meta = {
        type: "frame_meta",
        metadata: frame.metadata || {},
        tabId: rec.activeTabId,
        bytes: jpeg.length,
        ts: Date.now(),
      };
      for (const ws of rec.streamClients) {
        if (ws.readyState !== 1) continue;
        try {
          ws.send(JSON.stringify(meta));
          ws.send(jpeg);
        } catch {}
      }
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: STREAM_QUALITY,
      maxWidth: STREAM_MAX_W,
      maxHeight: STREAM_MAX_H,
      everyNthFrame: 1,
    });
    rec.streaming = true;
  } catch (err) {
    console.error(JSON.stringify({
      event: "screencast_start_failed",
      botId: rec.botId,
      error: err instanceof Error ? err.message : String(err),
    }));
    rec.streaming = false;
    sendAll(rec, { type: "error", error: "screencast failed — use screenshot fallback" });
  }
}

async function restartScreencast(rec) {
  if (rec.streamClients.size === 0) {
    await stopScreencast(rec);
    return;
  }
  await startScreencast(rec);
}

async function setActiveTab(rec, tabId) {
  const page = rec.pages.get(tabId);
  if (!page || page.isClosed()) throw new Error("tab not found");
  rec.activeTabId = tabId;
  rec.page = page;
  try { await page.bringToFront(); } catch {}
  await restartScreencast(rec);
  broadcastTabs(rec);
  broadcastMeta(rec);
}

async function openTab(rec, url = "about:blank") {
  const page = await rec.context.newPage();
  const id = registerPage(rec, page);
  await setActiveTab(rec, id);
  if (url && url !== "about:blank") {
    await page.goto(String(url), { waitUntil: "domcontentloaded" }).catch(() => {});
  }
  broadcastTabs(rec);
  return id;
}

async function closeTab(rec, tabId) {
  if (rec.pages.size <= 1) throw new Error("cannot close the last tab");
  const page = rec.pages.get(tabId);
  if (!page) throw new Error("tab not found");
  const wasActive = rec.activeTabId === tabId;
  await page.close({ runBeforeUnload: false }).catch(() => {});
  rec.pages.delete(tabId);
  if (wasActive) {
    const next = rec.pages.keys().next().value;
    await setActiveTab(rec, next);
  } else {
    broadcastTabs(rec);
  }
}

async function ensureComputer(botId) {
  const existing = computers.get(botId);
  if (existing) {
    existing.status = "running";
    return existing;
  }
  if (computers.size >= MAX) throw new Error(`Max computers (${MAX}) reached`);
  const profileDir = path.join(PROFILE_ROOT, botId);
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, launchOptsBase());
  if (STEALTH) {
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // Soften common automation fingerprints without claiming a full stealth stack.
        if (!window.chrome) window.chrome = { runtime: {} };
      } catch (_) {}
    });
  }
  const page = context.pages()[0] || (await context.newPage());
  const rec = {
    botId,
    context,
    page,
    pages: new Map(),
    activeTabId: "",
    nextTabSeq: 1,
    control: "bot",
    snapshotId: 0,
    refs: new Map(),
    startedAt: new Date().toISOString(),
    status: "running",
    cdp: null,
    streaming: false,
    streamClients: new Set(),
  };
  rec.activeTabId = registerPage(rec, page);
  context.on("page", (p) => {
    const id = registerPage(rec, p);
    void setActiveTab(rec, id);
  });
  if (page.url() === "about:blank") {
    await page.goto("about:blank").catch(() => {});
  }
  computers.set(botId, rec);
  return rec;
}

async function stopComputer(botId) {
  const rec = computers.get(botId);
  if (!rec) return;
  computers.delete(botId);
  for (const ws of rec.streamClients) {
    try { ws.close(); } catch {}
  }
  rec.streamClients.clear();
  await stopScreencast(rec);
  try { await rec.context.close(); } catch {}
}

async function buildSnapshot(rec) {
  rec.snapshotId += 1;
  rec.refs.clear();
  const page = rec.page;
  const url = page.url();
  const title = await page.title().catch(() => "");
  const handles = await page
    .locator("a, button, input, textarea, [role='button'], [role='link'], [role='textbox']")
    .all();
  const elements = [];
  let i = 0;
  for (const loc of handles.slice(0, 80)) {
    const ref = `e${i++}`;
    const role =
      (await loc.getAttribute("role").catch(() => null)) ||
      (await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "node"));
    const name =
      (await loc.innerText().catch(() => ""))?.trim().slice(0, 80) ||
      (await loc.getAttribute("aria-label").catch(() => null)) ||
      (await loc.getAttribute("placeholder").catch(() => null)) ||
      (await loc.getAttribute("name").catch(() => null)) ||
      ref;
    const disabled = Boolean(await loc.isDisabled().catch(() => false));
    rec.refs.set(ref, loc);
    elements.push({ ref, role, name, disabled });
  }
  return {
    snapshotId: rec.snapshotId,
    url,
    title,
    elements,
    truncated: handles.length > 80,
    activeTabId: rec.activeTabId,
  };
}


/** Browserbase-style low-latency human input over the screencast WebSocket. */
async function handleStreamInput(rec, msg) {
  if (!msg || typeof msg !== "object") return;
  const page = rec.page;
  if (!page || page.isClosed()) return;
  const type = String(msg.type || "");
  try {
    if (type === "navigate") {
      const url = String(msg.url || "").trim();
      if (!url) return;
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
      broadcastMeta(rec);
      return;
    }
    if (type === "click") {
      const x = Number(msg.x), y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const button = msg.button === "right" ? "right" : "left";
      if (rec.cdp) {
        const btn = button === "right" ? "right" : "left";
        const buttons = button === "right" ? 2 : 1;
        await rec.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
        await rec.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: btn, buttons, clickCount: 1 });
        await rec.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: btn, buttons: 0, clickCount: 1 });
      } else {
        await page.mouse.click(x, y, { button });
      }
      return;
    }
    if (type === "move") {
      const x = Number(msg.x), y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (rec.cdp) {
        await rec.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
      } else {
        await page.mouse.move(x, y);
      }
      return;
    }
    if (type === "scroll") {
      const x = Number(msg.x), y = Number(msg.y);
      const deltaX = Number(msg.deltaX) || 0, deltaY = Number(msg.deltaY) || 0;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (rec.cdp) await rec.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
        else await page.mouse.move(x, y);
      }
      await page.mouse.wheel(deltaX, deltaY);
      return;
    }
    if (type === "type") {
      const text = String(msg.text ?? "");
      if (!text) return;
      await page.keyboard.type(text, { delay: 0 });
      return;
    }
    if (type === "key") {
      const key = String(msg.key || "");
      if (!key) return;
      const mods = [];
      if (msg.altKey) mods.push("Alt");
      if (msg.ctrlKey) mods.push("Control");
      if (msg.metaKey) mods.push("Meta");
      if (msg.shiftKey && key.length !== 1) mods.push("Shift");
      if (key.length === 1 && !msg.ctrlKey && !msg.metaKey && !msg.altKey) {
        await page.keyboard.type(key, { delay: 0 });
      } else {
        await page.keyboard.press([...mods, key].join("+"));
      }
    }
  } catch (err) {
    console.error(JSON.stringify({
      event: "stream_input_error",
      botId: rec.botId,
      type,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function viewPage(botId) {
  const rec = computers.get(botId);
  const control = rec?.control ?? "unknown";
  const status = rec?.status ?? "missing";
  const wsBase = PUBLIC_BASE.replace(/^http/, "ws");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Aria session · ${botId}</title>
<style>
:root{color-scheme:dark;--bg:#0b0f17;--panel:#121826;--line:#243044;--text:#e8eefc;--muted:#8fa3c2;--accent:#5b8cff;--ok:#3dd68c;--warn:#ffb020}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:radial-gradient(1200px 600px at 20% -10%,#18233a 0%,var(--bg) 55%);color:var(--text);font-family:"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);background:rgba(12,18,30,.92);backdrop-filter:blur(10px);flex:0 0 auto;z-index:5}
body.fs .top{position:absolute;left:0;right:0;top:0}
body.fs:not(:hover) .top,#tabs{transition:opacity .2s}
body.fs:not(:hover) .top{opacity:.12}
body.fs:hover .top{opacity:1}
.brand{display:flex;flex-direction:column;gap:2px;min-width:0}
.brand .kicker{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7eb6ff}
.brand .title{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chiprow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:#0e1524;font:11px/1.2 "IBM Plex Mono",ui-monospace,monospace;color:var(--muted)}
.chip b{color:var(--text);font-weight:600}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(61,214,140,.15)}
.dot.warn{background:var(--warn);box-shadow:0 0 0 3px rgba(255,176,32,.15)}
.dot.bad{background:#ff5d6c;box-shadow:0 0 0 3px rgba(255,93,108,.15)}
.badge{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.human{background:#5b3410;color:#ffd29a}.bot{background:#10384f;color:#8de7ff}
.actions{display:flex;gap:8px;flex-wrap:wrap}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:7px 11px;font-weight:600;cursor:pointer;font-size:13px}
button.secondary{background:#24314d}button:disabled{opacity:.55;cursor:wait}
#tabs{display:flex;gap:4px;align-items:center;padding:6px 10px 0;background:#0a1220;border-bottom:1px solid var(--line);overflow-x:auto;flex:0 0 auto}
body.fs #tabs{padding-top:58px}
body.fs:not(:hover) #tabs{opacity:.12}
body.fs:hover #tabs{opacity:1}
.tab{display:flex;align-items:center;gap:6px;max-width:220px;padding:6px 10px;border-radius:8px 8px 0 0;background:#152038;color:#c6d4ef;border:1px solid #24314d;border-bottom:0;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tab.active{background:#1c2d52;color:#fff;box-shadow:inset 0 -2px 0 var(--accent)}
.tab .x{opacity:.55;border:0;background:transparent;color:inherit;padding:0 2px;cursor:pointer;font-size:14px}
.tab .x:hover{opacity:1;color:#ff8d9c}
#stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;background:#05070c}
#frame{position:relative;flex:1 1 auto;min-height:0;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
#canvas,#shot{display:block;max-width:100%;max-height:100%;width:auto;height:auto;cursor:crosshair;outline:none;user-select:none;background:#000}
#shot{display:none}
#metaBar{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:6px 12px;font:12px "IBM Plex Mono",ui-monospace,Menlo,monospace;color:var(--muted);border-top:1px solid var(--line);background:rgba(12,18,30,.95);flex:0 0 auto}
#fps,#rtt{color:#7fd7ff}#err{color:#ff8d9c}
.omnibox{flex:1 1 auto;display:flex;gap:8px;align-items:center;min-width:0}
.omnibox input{flex:1 1 auto;min-width:0;background:#0a1220;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:7px 10px;font:12px "IBM Plex Mono",ui-monospace,monospace}
.omnibox input:focus{outline:1px solid var(--accent);border-color:var(--accent)}
#banner{display:none;position:absolute;left:50%;top:64px;transform:translateX(-50%);z-index:8;padding:8px 14px;border-radius:999px;background:rgba(20,28,48,.92);border:1px solid var(--line);font-size:12px;color:var(--muted);backdrop-filter:blur(8px)}
#banner.show{display:block}
#sessionChip b{color:#9ad0ff}
</style>
</head>
<body class="${control === "human" ? "fs" : ""}">
<div class="top">
  <div class="brand">
    <div class="kicker">Aria live session</div>
    <div class="title">${botId}</div>
  </div>
  <div class="chiprow">
    <span class="chip"><span id="connDot" class="dot warn"></span><b id="connLabel">connecting</b></span>
    <span class="chip">FPS <b id="fps">—</b></span>
    <span class="chip">RTT <b id="rtt">—</b></span>
    <span class="chip" id="sessionChip">session <b>live</b></span>
    <span id="controlBadge" class="badge ${control === "human" ? "human" : "bot"}">${control}</span>
    <span id="statusText" class="chip">${status}</span>
  </div>
  <div class="actions">
    <button type="button" onclick="take()">Take control</button>
    <button type="button" class="secondary" onclick="release()">Release</button>
    <button type="button" class="secondary" onclick="newTab()">+ Tab</button>
    <button type="button" class="secondary" onclick="goLinkedIn()">LinkedIn</button>
    <button type="button" class="secondary" onclick="toggleFs()">Fullscreen</button>
  </div>
</div>
<div id="tabs"></div>
<div id="stage">
  <div id="frame">
    <canvas id="canvas" tabindex="0" aria-label="Live Aria browser session"></canvas>
    <img id="shot" tabindex="0" alt="Fallback screenshot"/>
  </div>
  <div id="banner">Reconnecting stream…</div>
<div id="metaBar">
  <form class="omnibox" id="omniForm" autocomplete="off">
    <input id="omni" type="url" spellcheck="false" placeholder="https:// — navigate like Browserbase / Steel"/>
  </form>
  <span id="err"></span>
</div>
</div>
<script>
const botId = ${JSON.stringify(botId)};
const token = ${JSON.stringify(COMPUTER_TOKEN)};
const publicBase = ${JSON.stringify(PUBLIC_BASE)};
const wsBase = ${JSON.stringify(wsBase)};
const base = publicBase + "/c/" + encodeURIComponent(botId);
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const shot = document.getElementById("shot");
const tabsEl = document.getElementById("tabs");
let human = ${control === "human" ? "true" : "false"};
let ws = null;
let frameCount = 0;
let lastFpsAt = Date.now();
let naturalW = 1400, naturalH = 900;
let useFallback = false;
let fallbackTimer = null;
let pendingKeys = [];
let keyFlushTimer = null;
let lastMeta = null;
let moveTimer = null;
let lastMove = null;
let pingTimer = null;
let lastPingAt = 0;

async function api(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + token,
      "x-openbot-computer-token": token,
      "x-openbot-bot-id": botId,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function sendInput(msg) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); return true; } catch (_) {}
  }
  return false;
}

function setOmni(url) {
  const el = document.getElementById("omni");
  if (el && document.activeElement !== el) el.value = url || "";
}

document.getElementById("omniForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const raw = (document.getElementById("omni").value || "").trim();
  if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  if (sendInput({ type: "navigate", url })) return;
  void api("/navigate", { url }).catch((e) => setErr(String(e.message || e)));
});


function setErr(msg) { document.getElementById("err").textContent = msg || ""; }
function setConn(state, label) {
  const dot = document.getElementById("connDot");
  const lab = document.getElementById("connLabel");
  dot.className = "dot" + (state === "ok" ? "" : state === "bad" ? " bad" : " warn");
  lab.textContent = label;
}

function mapPoint(ev, el) {
  const rect = el.getBoundingClientRect();
  const nw = naturalW || 1400, nh = naturalH || 900;
  if (!rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / nw, rect.height / nh);
  const drawW = nw * scale, drawH = nh * scale;
  const ox = rect.left + (rect.width - drawW) / 2;
  const oy = rect.top + (rect.height - drawH) / 2;
  const x = Math.round((ev.clientX - ox) / scale);
  const y = Math.round((ev.clientY - oy) / scale);
  if (x < 0 || y < 0 || x >= nw || y >= nh) return null;
  return { x, y };
}

function renderTabs(tabs) {
  tabsEl.innerHTML = "";
  for (const t of tabs || []) {
    const el = document.createElement("div");
    el.className = "tab" + (t.active ? " active" : "");
    el.title = t.url || "";
    const label = document.createElement("span");
    label.textContent = (t.title || "New tab").slice(0, 28);
    el.appendChild(label);
    const x = document.createElement("button");
    x.type = "button"; x.className = "x"; x.textContent = "×";
    x.onclick = (ev) => { ev.stopPropagation(); closeTab(t.id); };
    el.appendChild(x);
    el.onclick = () => activateTab(t.id);
    tabsEl.appendChild(el);
  }
}

async function enterFullscreen() {
  document.body.classList.add("fs");
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch (_) {}
  (useFallback ? shot : canvas).focus();
}
async function exitFullscreen() {
  document.body.classList.remove("fs");
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch (_) {}
}
async function toggleFs() {
  if (document.body.classList.contains("fs") && document.fullscreenElement) await exitFullscreen();
  else await enterFullscreen();
}

function bumpFps() {
  frameCount += 1;
  const now = Date.now();
  if (now - lastFpsAt >= 1000) {
    document.getElementById("fps").textContent = String(frameCount);
    frameCount = 0; lastFpsAt = now;
  }
}

function paintBitmap(bitmap, metadata) {
  naturalW = bitmap.width || metadata?.deviceWidth || naturalW;
  naturalH = bitmap.height || metadata?.deviceHeight || naturalH;
  if (canvas.width !== naturalW || canvas.height !== naturalH) {
    canvas.width = naturalW; canvas.height = naturalH;
  }
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  bumpFps();
  if (lastMeta?.ts) {
    const rtt = Math.max(0, Date.now() - lastMeta.ts);
    document.getElementById("rtt").textContent = rtt + "ms";
  }
}

async function paintBinary(buf) {
  try {
    const blob = new Blob([buf], { type: "image/jpeg" });
    if (createImageBitmap) {
      const bmp = await createImageBitmap(blob);
      paintBitmap(bmp, lastMeta?.metadata);
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      naturalW = img.naturalWidth || naturalW;
      naturalH = img.naturalHeight || naturalH;
      if (canvas.width !== naturalW || canvas.height !== naturalH) {
        canvas.width = naturalW; canvas.height = naturalH;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      bumpFps();
    };
    img.src = url;
  } catch (e) { setErr(String(e.message || e)); }
}

function paintFrameB64(b64, metadata) {
  const img = new Image();
  img.onload = () => {
    naturalW = img.naturalWidth || metadata?.deviceWidth || naturalW;
    naturalH = img.naturalHeight || metadata?.deviceHeight || naturalH;
    if (canvas.width !== naturalW || canvas.height !== naturalH) {
      canvas.width = naturalW; canvas.height = naturalH;
    }
    ctx.drawImage(img, 0, 0);
    bumpFps();
  };
  img.src = "data:image/jpeg;base64," + b64;
}

async function fallbackRefresh() {
  try {
    const res = await fetch(base + "/screenshot?ts=" + Date.now(), {
      headers: { authorization: "Bearer " + token, "x-openbot-computer-token": token, "x-openbot-bot-id": botId },
    });
    if (!res.ok) throw new Error("screenshot " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const old = shot.src;
    shot.onload = () => { naturalW = shot.naturalWidth || naturalW; naturalH = shot.naturalHeight || naturalH; };
    shot.src = url;
    if (old && old.startsWith("blob:")) URL.revokeObjectURL(old);
    const tabs = await fetch(base + "/tabs", {
      headers: { authorization: "Bearer " + token, "x-openbot-computer-token": token },
    }).then((r) => r.json()).catch(() => null);
    if (tabs?.tabs) renderTabs(tabs.tabs);
    setErr("");
  } catch (e) { setErr(String(e.message || e)); }
}

function enableFallback(reason) {
  if (useFallback) return;
  useFallback = true;
  canvas.style.display = "none";
  shot.style.display = "block";
  document.getElementById("fps").textContent = "~5";
  setConn("warn", "fallback");
  setErr(reason || "stream unavailable — fast screenshot fallback");
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = setInterval(fallbackRefresh, human ? 180 : 400);
  fallbackRefresh();
}

function connectStream() {
  if (ws) try { ws.close(); } catch (_) {}
  const url = wsBase + "/c/" + encodeURIComponent(botId) + "/stream?token=" + encodeURIComponent(token);
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    useFallback = false;
    canvas.style.display = "block";
    shot.style.display = "none";
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    setErr("");
    setConn("ok", "live");
    document.getElementById("banner").classList.remove("show");
    document.getElementById("fps").textContent = "…";
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === 1) {
        lastPingAt = Date.now();
        ws.send(JSON.stringify({ type: "ping", t: lastPingAt }));
      }
    }, 2000);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") {
      void paintBinary(ev.data);
      return;
    }
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "frame_meta") {
      lastMeta = msg;
      if (msg.metadata?.deviceWidth) naturalW = msg.metadata.deviceWidth;
      if (msg.metadata?.deviceHeight) naturalH = msg.metadata.deviceHeight;
    } else if (msg.type === "frame") {
      paintFrameB64(msg.data, msg.metadata);
    } else if (msg.type === "tabs") {
      renderTabs(msg.tabs);
    } else if (msg.type === "meta") {
      const badge = document.getElementById("controlBadge");
      badge.textContent = msg.control;
      badge.className = "badge " + (msg.control === "human" ? "human" : "bot");
      document.getElementById("statusText").textContent = msg.status || "";
      setOmni(msg.url || "");
      human = msg.control === "human";
      if (human) document.body.classList.add("fs");
    } else if (msg.type === "pong") {
      document.getElementById("rtt").textContent = Math.max(0, Date.now() - (msg.t || lastPingAt)) + "ms";
    } else if (msg.type === "error") {
      enableFallback(msg.error);
    }
  };
  ws.onerror = () => enableFallback("websocket error");
  ws.onclose = () => {
    setConn("bad", "reconnecting");
    document.getElementById("banner").classList.add("show");
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (!useFallback) setTimeout(connectStream, 800);
  };
}

async function take() { await api("/control/take", {}); human = true; await enterFullscreen(); connectStream(); }
async function release() { await api("/control/release", {}); human = false; await exitFullscreen(); }
async function goLinkedIn() { await api("/navigate", { url: "https://www.linkedin.com/" }); (useFallback ? shot : canvas).focus(); }
async function newTab(url) { await api("/tabs/new", url ? { url } : {}); (useFallback ? shot : canvas).focus(); }
async function activateTab(id) { await api("/tabs/activate", { id }); (useFallback ? shot : canvas).focus(); }
async function closeTab(id) { try { await api("/tabs/close", { id }); } catch (e) { setErr(String(e.message || e)); } }

function queueMove(pt) {
  lastMove = pt;
  if (moveTimer) return;
  moveTimer = setTimeout(() => {
    moveTimer = null;
    const p = lastMove; lastMove = null;
    if (!p) return;
    if (!sendInput({ type: "move", x: p.x, y: p.y })) {
      void api("/move-xy", { x: p.x, y: p.y, human: true }).catch(() => {});
    }
  }, 16);
}

function bindPointer(el) {
  el.addEventListener("pointerdown", (ev) => {
    const pt = mapPoint(ev, el);
    if (!pt) return;
    el.focus();
    const btn = ev.button === 2 ? "right" : "left";
    if (!sendInput({ type: "click", x: pt.x, y: pt.y, button: btn })) {
      void api("/click-xy", { x: pt.x, y: pt.y, button: btn, human: true })
        .catch((e) => setErr(String(e.message || e)));
    }
  });
  el.addEventListener("pointermove", (ev) => {
    if (!human) return;
    const pt = mapPoint(ev, el);
    if (pt) queueMove(pt);
  });
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());
  el.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const pt = mapPoint(ev, el);
    if (!pt) return;
    if (!sendInput({ type: "scroll", x: pt.x, y: pt.y, deltaX: ev.deltaX, deltaY: ev.deltaY })) {
      void api("/scroll", { x: pt.x, y: pt.y, deltaX: ev.deltaX, deltaY: ev.deltaY, human: true }).catch(() => {});
    }
  }, { passive: false });
  el.addEventListener("keydown", (ev) => {
    const key = ev.key; if (!key) return;
    if ((ev.metaKey || ev.ctrlKey) && key.toLowerCase() === "t") { ev.preventDefault(); void newTab(); return; }
    if ((ev.metaKey || ev.ctrlKey) && key.toLowerCase() === "w") { ev.preventDefault(); void api("/tabs/close-active", {}).catch((e) => setErr(String(e.message || e))); return; }
    if ((ev.metaKey || ev.ctrlKey) && key === "Tab") { ev.preventDefault(); void api("/tabs/next", { reverse: ev.shiftKey }).catch(() => {}); return; }
    ev.preventDefault(); ev.stopPropagation();
    pendingKeys.push({
      key, code: ev.code, text: key.length === 1 ? key : undefined,
      altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, shiftKey: ev.shiftKey, human: true,
    });
    if (!keyFlushTimer) keyFlushTimer = setTimeout(flushKeys, 16);
  });
}

async function flushKeys() {
  keyFlushTimer = null;
  const batch = pendingKeys.splice(0, pendingKeys.length);
  if (!batch.length) return;
  let i = 0;
  while (i < batch.length) {
    const run = [];
    while (i < batch.length && batch[i].text && !batch[i].ctrlKey && !batch[i].metaKey && !batch[i].altKey) {
      run.push(batch[i].text); i += 1;
    }
    if (run.length) {
      const text = run.join("");
      if (!sendInput({ type: "type", text })) {
        void api("/type-text", { text, human: true }).catch((e) => setErr(String(e.message || e)));
      }
      continue;
    }
    const k = batch[i++];
    if (!sendInput({ type: "key", ...k })) {
      void api("/key", k).catch((e) => setErr(String(e.message || e)));
    }
  }
}

bindPointer(canvas); bindPointer(shot);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && !human) document.body.classList.remove("fs");
});
const wantsFs = new URLSearchParams(location.search).get("fs") === "1";
if (human || wantsFs) {
  setTimeout(() => { (async () => {
    if (!human && wantsFs) { try { await take(); return; } catch (_) {} }
    await enterFullscreen().catch(() => {});
  })(); }, 40);
}
connectStream();
fetch(base + "/tabs", { headers: { authorization: "Bearer " + token, "x-openbot-computer-token": token } })
  .then((r) => r.json()).then((d) => { if (d?.tabs) renderTabs(d.tabs); }).catch(() => {});
</script>
</body>
</html>`;
}

async function handleComputer(botId, req, res, pathname, method) {
  if (!computerTokenOk(req)) return json(res, 401, { error: "Not authorised." });
  const rec = computers.get(botId);
  if (!rec) return json(res, 404, { error: "computer not ensured" });

  if (pathname === "/screenshot" && method === "GET") {
    const buf = await rec.page.screenshot({ type: "jpeg", quality: 60, animations: "disabled" });
    res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store", "content-length": buf.length });
    return res.end(buf);
  }

  if (pathname === "/tabs" && method === "GET") {
    return json(res, 200, { tabs: await tabList(rec), activeTabId: rec.activeTabId });
  }
  if (pathname === "/tabs/new" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const id = await openTab(rec, body.url || "about:blank");
    return json(res, 200, { id, tabs: await tabList(rec) });
  }
  if (pathname === "/tabs/activate" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    await setActiveTab(rec, String(body.id || ""));
    return json(res, 200, { activeTabId: rec.activeTabId, tabs: await tabList(rec) });
  }
  if (pathname === "/tabs/close" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    await closeTab(rec, String(body.id || ""));
    return json(res, 200, { tabs: await tabList(rec), activeTabId: rec.activeTabId });
  }
  if (pathname === "/tabs/close-active" && method === "POST") {
    await closeTab(rec, rec.activeTabId);
    return json(res, 200, { tabs: await tabList(rec), activeTabId: rec.activeTabId });
  }
  if (pathname === "/tabs/next" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const ids = [...rec.pages.keys()];
    if (!ids.length) return json(res, 400, { error: "no tabs" });
    const idx = Math.max(0, ids.indexOf(rec.activeTabId));
    const next = body.reverse ? ids[(idx - 1 + ids.length) % ids.length] : ids[(idx + 1) % ids.length];
    await setActiveTab(rec, next);
    return json(res, 200, { activeTabId: rec.activeTabId, tabs: await tabList(rec) });
  }

  if (pathname === "/read" && method === "GET") {
    return json(res, 200, {
      url: rec.page.url(),
      title: await rec.page.title().catch(() => ""),
      text: (await rec.page.locator("body").innerText().catch(() => "")).slice(0, 4000),
      activeTabId: rec.activeTabId,
      tabs: await tabList(rec),
    });
  }

  if (pathname === "/navigate" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const target = String(body.url || "");
    if (!target) return json(res, 400, { error: "url required" });
    await rec.page.goto(target, { waitUntil: "domcontentloaded" });
    broadcastTabs(rec); broadcastMeta(rec);
    return json(res, 200, {
      url: rec.page.url(),
      title: await rec.page.title().catch(() => ""),
      text: (await rec.page.locator("body").innerText().catch(() => "")).slice(0, 500),
      activeTabId: rec.activeTabId,
    });
  }

  if (pathname === "/snapshot" && method === "POST") {
    return json(res, 200, await buildSnapshot(rec));
  }

  if (pathname === "/click" && method === "POST") {
    if (rec.control === "human") return json(res, 409, { error: "human has control" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (body.snapshotId !== rec.snapshotId) return json(res, 409, { error: "stale snapshot", stale: true });
    const loc = rec.refs.get(String(body.ref || ""));
    if (!loc) return json(res, 404, { error: "ref not found" });
    try {
      const box = await loc.boundingBox();
      if (box) {
        const mx = box.x + box.width * (0.3 + Math.random() * 0.4);
        const my = box.y + box.height * (0.3 + Math.random() * 0.4);
        await rec.page.mouse.move(mx + randInt(-8, 8), my + randInt(-6, 6), { steps: randInt(4, 12) });
        await dwell(40, 140);
      }
    } catch {}
    await loc.click({ timeout: 15_000 });
    await dwell();
    return json(res, 200, { action: "click", ref: body.ref, url: rec.page.url() });
  }

  if (pathname === "/type" && method === "POST") {
    if (rec.control === "human") return json(res, 409, { error: "human has control" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (body.snapshotId !== rec.snapshotId) return json(res, 409, { error: "stale snapshot", stale: true });
    const loc = rec.refs.get(String(body.ref || ""));
    if (!loc) return json(res, 404, { error: "ref not found" });
    const text = String(body.text || "");
    await loc.click({ timeout: 15_000 });
    await dwell(80, 220);
    await rec.page.keyboard.type(text, { delay: randInt(40, 120) });
    await dwell();
    if (body.submit) await loc.press("Enter");
    return json(res, 200, { action: "type", ref: body.ref, characters: text.length });
  }

  if (pathname === "/session-probe" && method === "POST") {
    await rec.page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await dwell(200, 600);
    const url = rec.page.url();
    const title = await rec.page.title().catch(() => "");
    const text = (await rec.page.locator("body").innerText().catch(() => "")).slice(0, 2000);
    let healthy = false;
    let detail = "Could not confirm LinkedIn session — Take control and open linkedin.com/feed";
    if (looksLikeLinkedInAuthWall(text, title, url)) {
      healthy = false; detail = "LinkedIn login/checkpoint wall detected";
    } else if (/linkedin\\.com/i.test(url) && (/feed|messaging|in\\//i.test(url) || /linkedin/i.test(title))) {
      healthy = true; detail = "LinkedIn session appears logged in";
    }
    return json(res, 200, { healthy, detail, url });
  }

  if (pathname === "/click-xy" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: "x,y required" });
    const button = body.button === "right" ? "right" : "left";
    const humanFast = body.human === true || rec.control === "human";
    if (humanFast && rec.cdp) {
      const btn = button === "right" ? "right" : "left";
      const buttons = button === "right" ? 2 : 1;
      try {
        await rec.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved", x, y, button: "none", buttons: 0,
        });
        await rec.cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed", x, y, button: btn, buttons, clickCount: 1,
        });
        await rec.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased", x, y, button: btn, buttons: 0, clickCount: 1,
        });
        return json(res, 200, { action: "click-xy", x, y, button, via: "cdp", url: rec.page.url() });
      } catch {}
    }
    if (!humanFast) {
      try {
        await rec.page.mouse.move(x + randInt(-6, 6), y + randInt(-6, 6), { steps: randInt(3, 10) });
        await dwell(30, 100);
      } catch {}
    }
    await rec.page.mouse.click(x, y, { button, delay: humanFast ? 0 : undefined });
    return json(res, 200, { action: "click-xy", x, y, button, url: rec.page.url() });
  }

  if (pathname === "/move-xy" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const x = Number(body.x), y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: "x,y required" });
    if (rec.cdp) {
      try {
        await rec.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved", x, y, button: "none", buttons: 0,
        });
        return json(res, 200, { action: "move-xy", x, y, via: "cdp" });
      } catch {}
    }
    await rec.page.mouse.move(x, y);
    return json(res, 200, { action: "move-xy", x, y });
  }

  if (pathname === "/key" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const key = String(body.key || "");
    if (!key) return json(res, 400, { error: "key required" });
    const humanFast = body.human === true || rec.control === "human";
    const mods = [];
    if (body.altKey) mods.push("Alt");
    if (body.ctrlKey) mods.push("Control");
    if (body.metaKey) mods.push("Meta");
    if (body.shiftKey && key.length !== 1) mods.push("Shift");
    if (key.length === 1 && !body.ctrlKey && !body.metaKey && !body.altKey) {
      await rec.page.keyboard.type(key, { delay: humanFast ? 0 : 10 });
    } else {
      await rec.page.keyboard.press([...mods, key].join("+"));
    }
    return json(res, 200, { action: "key", key });
  }

  if (pathname === "/type-text" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const text = String(body.text ?? "");
    if (!text) return json(res, 400, { error: "text required" });
    const humanFast = body.human === true || rec.control === "human";
    await rec.page.keyboard.type(text, { delay: humanFast ? 0 : randInt(40, 120) });
    if (!humanFast) await dwell();
    if (body.submit) await rec.page.keyboard.press("Enter");
    return json(res, 200, { action: "type-text", characters: text.length });
  }

  if (pathname === "/scroll" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const x = Number(body.x), y = Number(body.y);
    const deltaX = Number(body.deltaX) || 0, deltaY = Number(body.deltaY) || 0;
    if (Number.isFinite(x) && Number.isFinite(y)) await rec.page.mouse.move(x, y);
    await rec.page.mouse.wheel(deltaX, deltaY);
    return json(res, 200, { action: "scroll", deltaX, deltaY });
  }

  if (pathname === "/control/take" && method === "POST") {
    rec.control = "human";
    broadcastMeta(rec);
    await restartScreencast(rec);
    return json(res, 200, { control: "human", streaming: rec.streaming });
  }
  if (pathname === "/control/release" && method === "POST") {
    rec.control = "bot";
    broadcastMeta(rec);
    return json(res, 200, { control: "bot" });
  }

  return json(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const method = req.method || "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type, x-openbot-computer-token, x-openbot-bot-id",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      });
      return res.end();
    }

    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true, computers: computers.size, headed: HEADED, max: MAX,
        stream: "cdp-screencast-binary", multitab: true, liveView: "browserbase-style",
        input: "websocket+cdp",
        sessions: true,
        stealth: STEALTH,
        proxy: Boolean(PROXY_SERVER),
        locale: LOCALE,
        timezone: TIMEZONE,
      });
    }

    const viewMatch = url.pathname.match(/^\/view\/([^/]+)$/);
    if (viewMatch && method === "GET") {
      const botId = decodeURIComponent(viewMatch[1]);
      if (!computers.has(botId)) {
        try { await ensureComputer(botId); }
        catch (err) {
          return html(res, 503, `<h1>Computer ${botId} unavailable</h1><p>${err instanceof Error ? err.message : String(err)}</p>`);
        }
      }
      return html(res, 200, viewPage(botId));
    }

    const cMatch = url.pathname.match(/^\/c\/([^/]+)(\/.*)?$/);
    if (cMatch) {
      const botId = decodeURIComponent(cMatch[1]);
      const pathname = cMatch[2] || "/";
      if (pathname === "/stream") return json(res, 426, { error: "Upgrade Required" });
      return await handleComputer(botId, req, res, pathname, method);
    }

    if (bearer(req) !== SUPERVISOR_TOKEN) return json(res, 401, { error: "Unauthorized." });

    // Browserbase/Steel-style session create: ensure seat + return connect/view URLs.
    if (url.pathname === "/sessions" && method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const botId = String(body.sessionId || body.botId || `sess_${Date.now().toString(36)}`).slice(0, 64);
      const startUrl = typeof body.url === "string" ? body.url.trim() : "";
      const rec = await ensureComputer(botId);
      if (startUrl) {
        await rec.page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
      }
      return json(res, 200, {
        ok: true,
        sessionId: botId,
        botId,
        status: rec.status,
        connectUrl: computerUrl(botId),
        viewUrl: viewUrl(botId) + "?fs=1",
        stream: "cdp-screencast-binary",
        liveView: "browserbase-style",
        pageUrl: rec.page.url(),
      });
    }

    const stateMatch = url.pathname.match(/^\/computers\/([^/]+)\/state$/);
    if (stateMatch && method === "GET") {
      const botId = decodeURIComponent(stateMatch[1]);
      const rec = computers.get(botId);
      if (!rec) return json(res, 404, { error: "not found" });
      return json(res, 200, {
        botId, status: rec.status, control: rec.control,
        url: computerUrl(botId), viewUrl: viewUrl(botId),
        pageUrl: rec.page.url(), activeTabId: rec.activeTabId,
        tabs: await tabList(rec), streaming: rec.streaming,
      });
    }

    const ensureMatch = url.pathname.match(/^\/computers\/([^/]+)\/ensure$/);
    if (ensureMatch && method === "POST") {
      const botId = decodeURIComponent(ensureMatch[1]);
      const rec = await ensureComputer(botId);
      return json(res, 200, {
        botId: rec.botId, container: `openbot-chromium-${rec.botId}`,
        status: rec.status, url: computerUrl(botId), viewUrl: viewUrl(botId),
        port: PORT, multitab: true, stream: "cdp-screencast",
      });
    }

    const stopMatch = url.pathname.match(/^\/computers\/([^/]+)\/stop$/);
    if (stopMatch && method === "POST") {
      await stopComputer(decodeURIComponent(stopMatch[1]));
      return json(res, 200, { stopped: true });
    }

    const resetMatch = url.pathname.match(/^\/computers\/([^/]+)\/reset$/);
    if (resetMatch && method === "POST") {
      const botId = decodeURIComponent(resetMatch[1]);
      await stopComputer(botId);
      const rec = await ensureComputer(botId);
      return json(res, 200, { reset: true, botId: rec.botId, url: computerUrl(botId), viewUrl: viewUrl(botId) });
    }

    if (url.pathname === "/computers" && method === "GET") {
      return json(res, 200, {
        computers: await Promise.all([...computers.values()].map(async (rec) => ({
          botId: rec.botId, status: rec.status, control: rec.control,
          url: computerUrl(rec.botId), viewUrl: viewUrl(rec.botId),
          pageUrl: rec.page.url(), activeTabId: rec.activeTabId,
          tabCount: rec.pages.size, streaming: rec.streaming, startedAt: rec.startedAt,
        }))),
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const m = url.pathname.match(/^\/c\/([^/]+)\/stream$/);
    if (!m) { socket.write("HTTP/1.1 404 Not Found\\r\\n\\r\\n"); socket.destroy(); return; }
    const botId = decodeURIComponent(m[1]);
    const token = url.searchParams.get("token") || "";
    if (token !== COMPUTER_TOKEN) { socket.write("HTTP/1.1 401 Unauthorized\\r\\n\\r\\n"); socket.destroy(); return; }
    const rec = computers.get(botId);
    if (!rec) { socket.write("HTTP/1.1 404 Not Found\\r\\n\\r\\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      rec.streamClients.add(ws);
      ws.send(JSON.stringify({
        type: "meta", control: rec.control, status: rec.status,
        activeTabId: rec.activeTabId, url: rec.page.url(),
      }));
      void tabList(rec).then((tabs) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "tabs", tabs })); });
      void startScreencast(rec);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "ping") {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: "pong", t: msg.t || Date.now() }));
            return;
          }
          // Human input over the same WS as the screencast (Browserbase/Steel feel).
          void handleStreamInput(rec, msg);
        } catch {}
      });
      ws.on("close", () => {
        rec.streamClients.delete(ws);
        if (rec.streamClients.size === 0) void stopScreencast(rec);
      });
      ws.on("error", () => { rec.streamClients.delete(ws); });
    });
  } catch {
    try { socket.destroy(); } catch {}
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({
    event: "openbot_chromium_supervisor_ready",
    port: PORT, headed: HEADED, max: MAX, publicBase: PUBLIC_BASE,
    stream: "cdp-screencast-binary", multitab: true, liveView: "browserbase-style",
    input: "websocket+cdp", sessions: true, stealth: STEALTH, proxy: Boolean(PROXY_SERVER),
    chrome: fs.existsSync(CHROME_PATH) ? CHROME_PATH : "playwright-default",
  }));
});

async function shutdown() {
  for (const botId of [...computers.keys()]) await stopComputer(botId);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
