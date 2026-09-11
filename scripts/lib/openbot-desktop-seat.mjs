/**
 * Per-seat virtual desktop for Aria OpenBot computers.
 *
 * Each seat: Xvfb + openbox + tint2 dock + x11vnc + websockify(noVNC).
 * Headed Chromium is maximized so Take control shows a real desktop VM
 * (browser chrome + OS taskbar) — Métis Operator style — not page-only CDP.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(HERE, "../desktop");

const DESKTOP_W = Number(process.env.OPENBOT_DESKTOP_WIDTH || 1600);
const DESKTOP_H = Number(process.env.OPENBOT_DESKTOP_HEIGHT || 1000);
const DISPLAY_BASE = Number(process.env.OPENBOT_DISPLAY_BASE || 100);

/** @type {Set<number>} */
const usedDisplays = new Set();

export function desktopModeEnabled() {
  if (process.env.OPENBOT_DESKTOP === "0") return false;
  if (process.env.OPENBOT_DESKTOP === "1") return true;
  return process.env.OPENBOT_HEADED === "1";
}

export function desktopGeometry() {
  return { width: DESKTOP_W, height: DESKTOP_H };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function allocDisplayNum() {
  for (let i = 0; i < 64; i += 1) {
    const n = DISPLAY_BASE + i;
    if (!usedDisplays.has(n)) {
      usedDisplays.add(n);
      return n;
    }
  }
  throw new Error("no free X displays for desktop seats");
}

function freeDisplayNum(n) {
  usedDisplays.delete(n);
}

function which(cmd) {
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    const p = path.join(d, cmd);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function spawnLogged(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });
  const label = `${cmd} ${(args || []).slice(0, 2).join(" ")}`;
  child.stderr?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) {
      console.error(JSON.stringify({ event: "desktop_child_stderr", cmd: label, line: line.slice(0, 300) }));
    }
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(JSON.stringify({ event: "desktop_child_exit", cmd: label, code, signal }));
    }
  });
  return child;
}

async function waitForTcp(port, host = "127.0.0.1", timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ port, host }, () => {
        s.end();
        resolve(true);
      });
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${host}:${port}`);
}

function novncWebRoot() {
  for (const candidate of ["/usr/share/novnc", "/usr/share/noVNC", "/usr/share/novnc/app"]) {
    if (
      fs.existsSync(path.join(candidate, "vnc.html")) ||
      fs.existsSync(path.join(candidate, "vnc_lite.html"))
    ) {
      return candidate;
    }
  }
  return "/usr/share/novnc";
}

function writeTint2Config(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const chrome = path.join(DESKTOP_DIR, "chrome.desktop");
  const files = path.join(DESKTOP_DIR, "files.desktop");
  const term = path.join(DESKTOP_DIR, "terminal.desktop");
  // tint2 v17 keys (Ubuntu jammy) — do not use obsolete clock_format / task_icon_size.
  const body = `# Aria OpenBot seat dock (tint2 v17)
rounded = 12
border_width = 0
background_color = #2a2e35 92
border_color = #000000 0

rounded = 8
border_width = 0
background_color = #3d4450 80
border_color = #000000 0

rounded = 8
border_width = 0
background_color = #5b8cff 100
border_color = #000000 0

panel_monitor = all
panel_position = bottom center horizontal
panel_size = 100% 48
panel_margin = 0 8
panel_padding = 8 4 8
panel_background_id = 1
panel_layer = top
panel_dock = 0
panel_items = LTSC

taskbar_mode = single_desktop
taskbar_padding = 4 2 4
task_maximum_size = 180 40
task_centered = 1
task_font = sans 9
task_font_color = #e8eefc 100
task_background_id = 2
task_active_background_id = 3
task_icon = 1
task_text = 0
task_icon_asb = 100 0 0

launcher_padding = 6 4 8
launcher_background_id = 0
launcher_icon_size = 28
launcher_item_app = ${chrome}
launcher_item_app = ${files}
launcher_item_app = ${term}

systray_padding = 4 0 4
systray_icon_size = 20

time1_format = %H:%M
time1_font = sans 10
clock_font_color = #c6d4ef 100
clock_padding = 8 0
clock_background_id = 0

autohide = 0
strut_policy = follow_size
`;
  const tint2rc = path.join(runtimeDir, "tint2rc");
  fs.writeFileSync(tint2rc, body);
  return tint2rc;
}

export async function startDesktopSeat(botId) {
  const missing = ["Xvfb", "openbox", "x11vnc"].filter((c) => !which(c));
  if (missing.length) throw new Error(`desktop seat missing binaries: ${missing.join(", ")}`);

  const displayNum = allocDisplayNum();
  const display = `:${displayNum}`;
  const vncPort = 5900 + displayNum;
  const wsPort = 6080 + displayNum;
  const width = DESKTOP_W;
  const height = DESKTOP_H;
  /** @type {import('node:child_process').ChildProcess[]} */
  const children = [];

  const stop = async () => {
    for (const child of [...children].reverse()) {
      try {
        if (!child.killed) child.kill("SIGTERM");
      } catch {}
    }
    await sleep(200);
    for (const child of children) {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {}
    }
    freeDisplayNum(displayNum);
  };

  try {
    children.push(
      spawnLogged(
        "Xvfb",
        [display, "-screen", "0", `${width}x${height}x24`, "-ac", "-nolisten", "tcp", "+extension", "RANDR"],
        { env: process.env },
      ),
    );
    await sleep(300);

    const env = { ...process.env, DISPLAY: display, HOME: process.env.HOME || "/tmp" };
    const openboxRc = path.join(DESKTOP_DIR, "openbox-rc.xml");
    const openboxArgs = fs.existsSync(openboxRc) ? ["--config-file", openboxRc] : [];
    children.push(spawnLogged("openbox", openboxArgs, { env }));
    await sleep(200);

    if (which("xsetroot")) spawnLogged("xsetroot", ["-solid", "#c5c9d1"], { env });

    if (which("tint2")) {
      const tint2rc = writeTint2Config(path.join("/tmp", `openbot-desktop-${displayNum}`));
      children.push(spawnLogged("tint2", ["-c", tint2rc], { env }));
    }

    children.push(
      spawnLogged(
        "x11vnc",
        [
          "-display", display,
          "-rfbport", String(vncPort),
          "-localhost",
          "-nopw",
          "-forever",
          "-shared",
          "-noxdamage",
          "-wait", "10",
          "-defer", "10",
          "-xkb",
          "-repeat",
        ],
        { env },
      ),
    );
    await waitForTcp(vncPort);

    const websockify = which("websockify");
    if (!websockify) throw new Error("websockify not found");
    children.push(
      spawnLogged(websockify, ["--web", novncWebRoot(), String(wsPort), `127.0.0.1:${vncPort}`], {
        env: process.env,
      }),
    );
    await waitForTcp(wsPort);

    console.log(
      JSON.stringify({
        event: "desktop_seat_started",
        botId,
        display,
        vncPort,
        wsPort,
        width,
        height,
      }),
    );

    return { botId, display, displayNum, width, height, vncPort, wsPort, children, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** Maximize Chromium on the seat display (best-effort). */
export async function maximizeChromeOnDisplay(display) {
  if (!which("xdotool")) return;
  const env = { ...process.env, DISPLAY: display };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await sleep(300);
    const ok = await new Promise((resolve) => {
      const child = spawn(
        "bash",
        [
          "-lc",
          `ids=$(xdotool search --onlyvisible --class 'Chromium|Google-chrome|chrome' 2>/dev/null | head -1); ` +
            `if [ -n "$ids" ]; then xdotool windowactivate --sync "$ids"; ` +
            `xdotool windowsize --sync "$ids" 100% 100%; xdotool windowmove --sync "$ids" 0 0; exit 0; fi; exit 1`,
        ],
        { env, stdio: "ignore" },
      );
      child.on("exit", (code) => resolve(code === 0));
    });
    if (ok) return;
  }
}

/**
 * Proxy HTTP to a seat's websockify/noVNC port.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} wsPort
 * @param {string} prefix e.g. /desktop/botId
 */
export function proxyDesktopHttp(req, res, wsPort, prefix) {
  let rest = req.url || "/";
  if (rest.startsWith(prefix)) rest = rest.slice(prefix.length) || "/";
  if (!rest.startsWith("/")) rest = `/${rest}`;
  if (rest === "/" || rest === "") rest = "/vnc.html";
  const headers = { ...req.headers, host: `127.0.0.1:${wsPort}` };
  const preq = http.request(
    {
      hostname: "127.0.0.1",
      port: wsPort,
      path: rest,
      method: req.method,
      headers,
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    },
  );
  preq.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`desktop proxy error: ${err.message}`);
  });
  req.pipe(preq);
}

/**
 * Bridge client WS ↔ local websockify.
 * @param {import('ws').WebSocket} clientWs
 * @param {number} wsPort
 * @param {typeof import('ws').WebSocket} WebSocketCtor
 */
export function bridgeDesktopWebSocket(clientWs, wsPort, WebSocketCtor) {
  const upstream = new WebSocketCtor(`ws://127.0.0.1:${wsPort}/`, { perMessageDeflate: false });
  /** @type {Buffer[]} */
  const pending = [];
  let open = false;

  upstream.on("open", () => {
    open = true;
    for (const msg of pending) upstream.send(msg);
    pending.length = 0;
  });
  upstream.on("message", (data, isBinary) => {
    if (clientWs.readyState === 1) clientWs.send(data, { binary: isBinary });
  });
  upstream.on("close", () => {
    try {
      clientWs.close();
    } catch {}
  });
  upstream.on("error", () => {
    try {
      clientWs.close();
    } catch {}
  });

  clientWs.on("message", (data) => {
    if (!open) {
      pending.push(data);
      return;
    }
    if (upstream.readyState === 1) upstream.send(data);
  });
  clientWs.on("close", () => {
    try {
      upstream.close();
    } catch {}
  });
  clientWs.on("error", () => {
    try {
      upstream.close();
    } catch {}
  });
}

/** Operator-facing desktop shell (full-bleed noVNC). */
export function desktopShellHtml({ botId, publicBase, control }) {
  const pathBase = `/desktop/${encodeURIComponent(botId)}`;
  // noVNC path= is the websocket URL path on the public host
  const vncUrl =
    `${pathBase}/vnc.html?autoconnect=1&resize=scale&reconnect=1` +
    `&path=${encodeURIComponent(`desktop/${botId}/websockify`)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Aria desktop · ${botId}</title>
<style>
  :root { color-scheme: dark; --bg:#0b0f17; --line:#243044; --text:#e8eefc; --muted:#8fa3c2; --accent:#5b8cff; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--text); font-family:"IBM Plex Sans",system-ui,sans-serif; overflow:hidden; }
  #bar { display:flex; align-items:center; gap:10px; padding:8px 12px; border-bottom:1px solid var(--line); background:#121826; height:48px; }
  #bar .title { font-weight:700; font-size:13px; }
  #bar .chip { font:11px/1.2 ui-monospace,monospace; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  #bar .chip b { color:var(--text); }
  #bar a, #bar button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:7px 11px; font-weight:600; cursor:pointer; font-size:12px; text-decoration:none; }
  #bar a.secondary, #bar button.secondary { background:#24314d; }
  #frame { position:absolute; inset:48px 0 0 0; background:#000; }
  #frame iframe { border:0; width:100%; height:100%; }
  body.fs #bar { position:absolute; left:0; right:0; top:0; z-index:5; opacity:.55; transition:opacity .2s; }
  body.fs:hover #bar { opacity:1; }
  body.fs #frame { inset:0; }
</style>
</head>
<body class="fs">
  <div id="bar">
    <div class="title">Aria desktop · ${botId}</div>
    <span class="chip">control <b>${control || "bot"}</b></span>
    <span class="chip">real Chrome + taskbar</span>
    <div style="flex:1"></div>
    <a class="secondary" href="${publicBase}/view/${encodeURIComponent(botId)}?page=1">Page view</a>
    <button type="button" onclick="document.documentElement.requestFullscreen?.()">Fullscreen</button>
  </div>
  <div id="frame">
    <iframe id="vnc" allow="clipboard-read; clipboard-write; fullscreen" src="${vncUrl}" title="Desktop VNC"></iframe>
  </div>
</body>
</html>`;
}
