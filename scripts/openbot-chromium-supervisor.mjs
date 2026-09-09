#!/usr/bin/env node
/**
 * OpenBot-compatible Chromium supervisor for Aria Fleet.
 *
 * 1 seat = 1 Chromium profile (Playwright / Google Chrome).
 * Implements supervisor ensure/stop/reset + agent-computer navigate/snapshot/
 * click/type/control + a live /view/:botId page for Take control.
 *
 * Env:
 *   OPENBOT_SUPERVISOR_PORT=18765
 *   SUPERVISOR_TOKEN=...
 *   COMPUTER_TOKEN=...
 *   OPENBOT_HEADED=1          # show real Chrome windows on $DISPLAY
 *   OPENBOT_MAX_COMPUTERS=10
 *   OPENBOT_PROFILE_ROOT=/tmp/aria-openbot/profiles
 *   OPENBOT_PUBLIC_BASE=http://127.0.0.1:18765
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(
  process.env.PORT || process.env.OPENBOT_SUPERVISOR_PORT || 18765,
);
const SUPERVISOR_TOKEN = (process.env.SUPERVISOR_TOKEN || "aria-supervisor-dev").trim();
const COMPUTER_TOKEN = (process.env.COMPUTER_TOKEN || "aria-computer-dev").trim();
const HEADED = process.env.OPENBOT_HEADED === "1";
const MAX = Number(process.env.OPENBOT_MAX_COMPUTERS || 10);
const PROFILE_ROOT = process.env.OPENBOT_PROFILE_ROOT || "/tmp/aria-openbot/profiles";
const PUBLIC_BASE = (process.env.OPENBOT_PUBLIC_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const CHROME_PATH =
  process.env.OPENBOT_CHROME_PATH ||
  // Playwright browsers path in Docker (Dockerfile.computers)
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  "/usr/local/bin/google-chrome";

fs.mkdirSync(PROFILE_ROOT, { recursive: true });

/** @typedef {{
 *  botId: string,
 *  context: import('playwright').BrowserContext,
 *  page: import('playwright').Page,
 *  control: 'bot'|'human',
 *  snapshotId: number,
 *  refs: Map<string, import('playwright').Locator>,
 *  startedAt: string,
 *  status: string,
 * }} Computer */

/** @type {Map<string, Computer>} */
const computers = new Map();
/** @type {import('playwright').Browser | null} */
let sharedBrowser = null;

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
  const auth = String(req.headers.authorization || "");
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function computerTokenOk(req) {
  const header = req.headers["x-openbot-computer-token"];
  const tok =
    (typeof header === "string" ? header : "") ||
    bearer(req);
  return tok === COMPUTER_TOKEN;
}

function botIdFromReq(req, fallback = "") {
  const h = req.headers["x-openbot-bot-id"];
  return String(typeof h === "string" ? h : fallback).trim();
}

async function getBrowser() {
  if (sharedBrowser) return sharedBrowser;
  const launchOpts = {
    headless: !HEADED,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800",
    ],
  };
  if (fs.existsSync(CHROME_PATH)) {
    launchOpts.executablePath = CHROME_PATH;
  }
  sharedBrowser = await chromium.launch(launchOpts);
  return sharedBrowser;
}

async function ensureComputer(botId) {
  const existing = computers.get(botId);
  if (existing) {
    existing.status = "running";
    return existing;
  }
  if (computers.size >= MAX) {
    throw new Error(`Max computers (${MAX}) reached`);
  }
  const browser = await getBrowser();
  const profileDir = path.join(PROFILE_ROOT, botId);
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  // Persist storage state path for later sessions
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  if (HEADED) {
    // Offset windows so multiple agents are visible on the desktop
    const idx = computers.size;
    const x = 40 + (idx % 5) * 60;
    const y = 40 + Math.floor(idx / 5) * 60;
    try {
      const session = await context.newCDPSession(page);
      await session.send("Browser.setWindowBounds", {
        windowId: (await session.send("Browser.getWindowForTarget")).windowId,
        bounds: { left: x, top: y, width: 1100, height: 720, windowState: "normal" },
      });
    } catch {
      /* ignore window placement failures */
    }
  }
  await page.goto("about:blank");
  const rec = {
    botId,
    context,
    page,
    control: "bot",
    snapshotId: 0,
    refs: new Map(),
    startedAt: new Date().toISOString(),
    status: "running",
  };
  computers.set(botId, rec);
  return rec;
}

async function stopComputer(botId) {
  const rec = computers.get(botId);
  if (!rec) return;
  computers.delete(botId);
  try {
    await rec.context.close();
  } catch {
    /* ignore */
  }
}

function viewUrl(botId) {
  return `${PUBLIC_BASE}/view/${encodeURIComponent(botId)}`;
}

function computerUrl(botId) {
  // Agent-computer verbs are served on the same host; Aria stores this as remoteUrl.
  return `${PUBLIC_BASE}/c/${encodeURIComponent(botId)}`;
}

async function buildSnapshot(rec) {
  rec.snapshotId += 1;
  rec.refs.clear();
  const page = rec.page;
  const url = page.url();
  const title = await page.title().catch(() => "");
  const handles = await page.locator("a, button, input, textarea, [role='button'], [role='link'], [role='textbox']").all();
  const elements = [];
  let i = 0;
  for (const loc of handles.slice(0, 80)) {
    const ref = `e${i++}`;
    const role = (await loc.getAttribute("role").catch(() => null)) || (await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => "node"));
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
  return { snapshotId: rec.snapshotId, url, title, elements, truncated: handles.length > 80 };
}

function viewPage(botId) {
  const rec = computers.get(botId);
  const control = rec?.control ?? "unknown";
  const status = rec?.status ?? "missing";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenBot ${botId}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    html, body { margin: 0; height: 100%; background: #05070c; color: #e8eefc; overflow: hidden; }
    body { display: flex; flex-direction: column; }
    header {
      display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;
      padding:10px 14px; border-bottom:1px solid #1e2a44; background:#0c1424; z-index:5;
      flex: 0 0 auto;
    }
    body.fs header { position: absolute; left: 0; right: 0; top: 0; background: rgba(12,20,36,.92); backdrop-filter: blur(8px); }
    body.fs header.collapsed { transform: translateY(-110%); transition: transform .2s ease; }
    body.fs:hover header.collapsed { transform: translateY(0); }
    .badge { padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    .human { background:#5b3410; color:#ffd29a; }
    .bot { background:#10384f; color:#8de7ff; }
    button { background:#5b7cfa; color:white; border:0; border-radius:8px; padding:8px 12px; font-weight:600; cursor:pointer; }
    button.secondary { background:#24314d; }
    button:disabled { opacity:.55; cursor:wait; }
    #stage {
      flex: 1 1 auto; min-height: 0; display:flex; flex-direction:column; gap:8px;
      padding: 12px; background:#05070c;
    }
    body.fs #stage { padding: 0; }
    #hint { font-size:12px; color:#9db0d0; }
    body.fs #hint { display:none; }
    #meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#9db0d0; }
    #err { color:#ff8d9c; min-height:1.2em; font-size:13px; }
    #frame {
      position: relative; flex: 1 1 auto; min-height: 0; background:#000;
      border:1px solid #24314d; border-radius:12px; overflow:hidden;
      display:flex; align-items:center; justify-content:center;
    }
    body.fs #frame { border:0; border-radius:0; }
    #shot {
      display:block; max-width:100%; max-height:100%; width:auto; height:auto;
      cursor: crosshair; outline: none; user-select: none; -webkit-user-drag: none;
      background:#000;
    }
    #shot:focus { box-shadow: inset 0 0 0 2px #5b7cfa; }
    #typebox {
      width: min(720px, 100%); border-radius:8px; border:1px solid #24314d; background:#0c1424;
      color:#e8eefc; padding:10px 12px; font-size:14px;
    }
    body.fs #typeRow { display:none; }
    #typeRow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  </style>
</head>
<body class="${control === "human" ? "fs" : ""}">
  <header id="toolbar">
    <div>
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#7fd7ff">Live Chromium computer</div>
      <div style="font-weight:700;margin-top:2px">${botId}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span id="controlBadge" class="badge ${control === "human" ? "human" : "bot"}">${control}</span>
      <span id="statusText" style="font-size:12px;color:#9db0d0">${status}</span>
      <button type="button" id="btnTake" onclick="take()">Take control</button>
      <button type="button" class="secondary" id="btnRelease" onclick="release()">Release</button>
      <button type="button" class="secondary" onclick="goLinkedIn()">Open LinkedIn</button>
      <button type="button" class="secondary" onclick="toggleFs()">Fullscreen</button>
    </div>
  </header>
  <div id="stage">
    <div id="hint">Click the desktop to focus · type normally · Esc releases focus · Take control opens fullscreen</div>
    <div id="meta">loading…</div>
    <div id="err"></div>
    <div id="frame">
      <img id="shot" tabindex="0" alt="Live Chromium screenshot — click then type" />
    </div>
    <div id="typeRow">
      <input id="typebox" type="text" autocomplete="off" spellcheck="false"
        placeholder="Type here and press Enter to send into the focused LinkedIn field" />
      <button type="button" class="secondary" onclick="sendTypebox()">Send text</button>
    </div>
  </div>
  <script>
    const botId = ${JSON.stringify(botId)};
    const token = ${JSON.stringify(COMPUTER_TOKEN)};
    const supervisorToken = ${JSON.stringify(SUPERVISOR_TOKEN)};
    const publicBase = ${JSON.stringify(PUBLIC_BASE)};
    const base = publicBase + '/c/' + encodeURIComponent(botId);
    const shot = document.getElementById('shot');
    const typebox = document.getElementById('typebox');
    let human = ${control === "human" ? "true" : "false"};
    let busy = false;
    let refreshTimer = null;
    let pauseRefreshUntil = 0;

    async function api(path, body) {
      const res = await fetch(base + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
          'x-openbot-computer-token': token,
          'x-openbot-bot-id': botId,
        },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    function setErr(msg) {
      document.getElementById('err').textContent = msg || '';
    }

    function mapPoint(ev) {
      const rect = shot.getBoundingClientRect();
      const nw = shot.naturalWidth || 1280;
      const nh = shot.naturalHeight || 800;
      if (!rect.width || !rect.height) return null;
      const x = Math.round((ev.clientX - rect.left) * (nw / rect.width));
      const y = Math.round((ev.clientY - rect.top) * (nh / rect.height));
      return {
        x: Math.max(0, Math.min(nw - 1, x)),
        y: Math.max(0, Math.min(nh - 1, y)),
      };
    }

    async function enterFullscreen() {
      document.body.classList.add('fs');
      const root = document.documentElement;
      try {
        if (!document.fullscreenElement && root.requestFullscreen) {
          await root.requestFullscreen();
        }
      } catch (_) { /* browser may block without gesture — body.fs still fills the window */ }
      shot.focus();
    }

    async function exitFullscreen() {
      document.body.classList.remove('fs');
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch (_) {}
    }

    async function toggleFs() {
      if (document.body.classList.contains('fs') && document.fullscreenElement) await exitFullscreen();
      else await enterFullscreen();
    }

    async function refresh() {
      if (Date.now() < pauseRefreshUntil) return;
      try {
        const res = await fetch(base + '/screenshot?ts=' + Date.now(), {
          headers: {
            'authorization': 'Bearer ' + token,
            'x-openbot-computer-token': token,
            'x-openbot-bot-id': botId,
          },
        });
        if (!res.ok) throw new Error('screenshot ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const old = shot.src;
        shot.src = url;
        if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
        const meta = await fetch(base + '/read', {
          headers: {
            'authorization': 'Bearer ' + token,
            'x-openbot-computer-token': token,
            'x-openbot-bot-id': botId,
          },
        }).then(r => r.json());
        document.getElementById('meta').textContent = (meta.title || '') + ' — ' + (meta.url || '');
        setErr('');
        const st = await fetch(publicBase + '/computers/' + encodeURIComponent(botId) + '/state', {
          headers: { 'authorization': 'Bearer ' + supervisorToken },
        }).then(r => r.json()).catch(() => null);
        if (st) {
          const badge = document.getElementById('controlBadge');
          badge.textContent = st.control;
          badge.className = 'badge ' + (st.control === 'human' ? 'human' : 'bot');
          document.getElementById('statusText').textContent = st.status;
          human = st.control === 'human';
          if (human) document.body.classList.add('fs');
        }
      } catch (e) {
        setErr(String(e.message || e));
      }
    }

    function scheduleRefresh() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(refresh, human ? 900 : 1400);
    }

    async function take() {
      await api('/control/take', {});
      human = true;
      await enterFullscreen();
      await refresh();
      scheduleRefresh();
    }

    async function release() {
      await api('/control/release', {});
      human = false;
      await exitFullscreen();
      await refresh();
      scheduleRefresh();
    }

    async function goLinkedIn() {
      await api('/navigate', { url: 'https://www.linkedin.com/' });
      pauseRefreshUntil = Date.now() + 400;
      await refresh();
      shot.focus();
    }

    async function sendTypebox() {
      const text = typebox.value;
      if (!text) return;
      try {
        await api('/type-text', { text });
        typebox.value = '';
        pauseRefreshUntil = Date.now() + 250;
        await refresh();
        shot.focus();
      } catch (e) {
        setErr(String(e.message || e));
      }
    }

    shot.addEventListener('pointerdown', async (ev) => {
      if (busy) return;
      const pt = mapPoint(ev);
      if (!pt) return;
      busy = true;
      pauseRefreshUntil = Date.now() + 500;
      try {
        shot.focus();
        await api('/click-xy', { x: pt.x, y: pt.y, button: ev.button === 2 ? 'right' : 'left' });
        await refresh();
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        busy = false;
      }
    });

    shot.addEventListener('contextmenu', (ev) => ev.preventDefault());

    shot.addEventListener('wheel', async (ev) => {
      ev.preventDefault();
      const pt = mapPoint(ev);
      if (!pt) return;
      pauseRefreshUntil = Date.now() + 200;
      try {
        await api('/scroll', { x: pt.x, y: pt.y, deltaX: ev.deltaX, deltaY: ev.deltaY });
      } catch (e) {
        setErr(String(e.message || e));
      }
    }, { passive: false });

    shot.addEventListener('keydown', async (ev) => {
      if (ev.target === typebox) return;
      // Let browser shortcuts with meta/ctrl alone pass except copy/paste we forward.
      const key = ev.key;
      if (!key) return;
      ev.preventDefault();
      ev.stopPropagation();
      pauseRefreshUntil = Date.now() + 180;
      try {
        await api('/key', {
          key,
          code: ev.code,
          text: key.length === 1 ? key : undefined,
          altKey: ev.altKey,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          shiftKey: ev.shiftKey,
        });
      } catch (e) {
        setErr(String(e.message || e));
      }
    });

    typebox.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        sendTypebox();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && !human) document.body.classList.remove('fs');
    });

    // Auto-fullscreen when already in human control (e.g. Take control from Aria).
    const wantsFs = new URLSearchParams(location.search).get('fs') === '1';
    if (human || wantsFs) {
      setTimeout(() => {
        (async () => {
          if (!human && wantsFs) {
            try { await take(); return; } catch (_) {}
          }
          await enterFullscreen().catch(() => {});
        })();
      }, 50);
    }

    scheduleRefresh();
    refresh();
  </script>
</body>
</html>`;
}

async function handleComputer(botId, req, res, pathname, method) {
  if (!computerTokenOk(req)) return json(res, 401, { error: "Not authorised." });
  let rec = computers.get(botId);
  if (!rec && method !== "OPTIONS") {
    return json(res, 404, { error: "computer not ensured" });
  }

  if (pathname === "/screenshot" && method === "GET") {
    const buf = await rec.page.screenshot({ type: "jpeg", quality: 70 });
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "content-length": buf.length,
    });
    return res.end(buf);
  }

  if (pathname === "/read" && method === "GET") {
    return json(res, 200, {
      url: rec.page.url(),
      title: await rec.page.title().catch(() => ""),
      text: (await rec.page.locator("body").innerText().catch(() => "")).slice(0, 4000),
    });
  }

  if (pathname === "/navigate" && method === "POST") {
    // Operator view may navigate while human has control; Aria's ComputerSupervisor
    // still refuses bot jobs when control === "human".
    const body = JSON.parse((await readBody(req)) || "{}");
    const target = String(body.url || "");
    if (!target) return json(res, 400, { error: "url required" });
    await rec.page.goto(target, { waitUntil: "domcontentloaded" });
    return json(res, 200, {
      url: rec.page.url(),
      title: await rec.page.title().catch(() => ""),
      text: (await rec.page.locator("body").innerText().catch(() => "")).slice(0, 500),
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
    await loc.click({ timeout: 15_000 });
    return json(res, 200, { action: "click", ref: body.ref, url: rec.page.url() });
  }

  if (pathname === "/type" && method === "POST") {
    if (rec.control === "human") return json(res, 409, { error: "human has control" });
    const body = JSON.parse((await readBody(req)) || "{}");
    if (body.snapshotId !== rec.snapshotId) return json(res, 409, { error: "stale snapshot", stale: true });
    const loc = rec.refs.get(String(body.ref || ""));
    if (!loc) return json(res, 404, { error: "ref not found" });
    await loc.fill(String(body.text || ""), { timeout: 15_000 });
    if (body.submit) await loc.press("Enter");
    return json(res, 200, { action: "type", ref: body.ref, characters: String(body.text || "").length });
  }

  if (pathname === "/click-xy" && method === "POST") {
    // Human (or assisted) click on screenshot coordinates.
    const body = JSON.parse((await readBody(req)) || "{}");
    const x = Number(body.x);
    const y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: "x,y required" });
    const button = body.button === "right" ? "right" : "left";
    await rec.page.mouse.click(x, y, { button });
    return json(res, 200, { action: "click-xy", x, y, button, url: rec.page.url() });
  }

  if (pathname === "/key" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const key = String(body.key || "");
    if (!key) return json(res, 400, { error: "key required" });
    const mods = [];
    if (body.altKey) mods.push("Alt");
    if (body.ctrlKey) mods.push("Control");
    if (body.metaKey) mods.push("Meta");
    if (body.shiftKey && key.length !== 1) mods.push("Shift");
    // Printable characters: prefer keyboard.type so focused inputs receive text.
    if (key.length === 1 && !body.ctrlKey && !body.metaKey && !body.altKey) {
      await rec.page.keyboard.type(key, { delay: 10 });
    } else {
      const chord = [...mods, key].join("+");
      await rec.page.keyboard.press(chord);
    }
    return json(res, 200, { action: "key", key });
  }

  if (pathname === "/type-text" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const text = String(body.text ?? "");
    if (!text) return json(res, 400, { error: "text required" });
    await rec.page.keyboard.type(text, { delay: 15 });
    if (body.submit) await rec.page.keyboard.press("Enter");
    return json(res, 200, { action: "type-text", characters: text.length });
  }

  if (pathname === "/scroll" && method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const x = Number(body.x);
    const y = Number(body.y);
    const deltaX = Number(body.deltaX) || 0;
    const deltaY = Number(body.deltaY) || 0;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      await rec.page.mouse.move(x, y);
    }
    await rec.page.mouse.wheel(deltaX, deltaY);
    return json(res, 200, { action: "scroll", deltaX, deltaY });
  }

  if (pathname === "/control/take" && method === "POST") {
    rec.control = "human";
    return json(res, 200, { control: "human" });
  }
  if (pathname === "/control/release" && method === "POST") {
    rec.control = "bot";
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
        ok: true,
        computers: computers.size,
        headed: HEADED,
        max: MAX,
      });
    }

    // Live operator view (no auth for local demo; token still required for actions)
    const viewMatch = url.pathname.match(/^\/view\/([^/]+)$/);
    if (viewMatch && method === "GET") {
      const botId = decodeURIComponent(viewMatch[1]);
      if (!computers.has(botId)) {
        try {
          await ensureComputer(botId);
        } catch (err) {
          return html(
            res,
            503,
            `<h1>Computer ${botId} unavailable</h1><p>${err instanceof Error ? err.message : String(err)}</p>`,
          );
        }
      }
      return html(res, 200, viewPage(botId));
    }

    // Agent-computer under /c/:botId/*
    const cMatch = url.pathname.match(/^\/c\/([^/]+)(\/.*)?$/);
    if (cMatch) {
      const botId = decodeURIComponent(cMatch[1]);
      const pathname = cMatch[2] || "/";
      return await handleComputer(botId, req, res, pathname, method);
    }

    // Supervisor auth
    if (bearer(req) !== SUPERVISOR_TOKEN) {
      return json(res, 401, { error: "Unauthorized." });
    }

    const stateMatch = url.pathname.match(/^\/computers\/([^/]+)\/state$/);
    if (stateMatch && method === "GET") {
      const botId = decodeURIComponent(stateMatch[1]);
      const rec = computers.get(botId);
      if (!rec) return json(res, 404, { error: "not found" });
      return json(res, 200, {
        botId,
        status: rec.status,
        control: rec.control,
        url: computerUrl(botId),
        viewUrl: viewUrl(botId),
        pageUrl: rec.page.url(),
      });
    }

    const ensureMatch = url.pathname.match(/^\/computers\/([^/]+)\/ensure$/);
    if (ensureMatch && method === "POST") {
      const botId = decodeURIComponent(ensureMatch[1]);
      const rec = await ensureComputer(botId);
      return json(res, 200, {
        botId: rec.botId,
        container: `openbot-chromium-${rec.botId}`,
        status: rec.status,
        url: computerUrl(botId),
        viewUrl: viewUrl(botId),
        // Aria uses url as agent-computer base; Fleet can open viewUrl for humans.
        port: PORT,
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
      return json(res, 200, {
        reset: true,
        botId: rec.botId,
        url: computerUrl(botId),
        viewUrl: viewUrl(botId),
      });
    }

    if (url.pathname === "/computers" && method === "GET") {
      return json(res, 200, {
        computers: [...computers.values()].map((rec) => ({
          botId: rec.botId,
          status: rec.status,
          control: rec.control,
          url: computerUrl(rec.botId),
          viewUrl: viewUrl(rec.botId),
          pageUrl: rec.page.url(),
          startedAt: rec.startedAt,
        })),
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "openbot_chromium_supervisor_ready",
      port: PORT,
      headed: HEADED,
      max: MAX,
      publicBase: PUBLIC_BASE,
      chrome: fs.existsSync(CHROME_PATH) ? CHROME_PATH : "playwright-default",
    }),
  );
});

async function shutdown() {
  for (const botId of [...computers.keys()]) {
    await stopComputer(botId);
  }
  if (sharedBrowser) await sharedBrowser.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
