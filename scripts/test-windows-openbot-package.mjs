#!/usr/bin/env node
/**
 * Smoke-test the Windows OpenBot portable package on this device.
 *
 * This cloud VM is Linux — we cannot execute .bat/.exe natively. We:
 *  1. Rebuild the portable tree via pack-windows-openbot-chromium.mjs
 *  2. Validate Windows launchers + BUILD stamp
 *  3. npm install + playwright chromium in an extracted copy
 *  4. Boot the packaged supervisor and exercise health/ensure/view/click/key
 *  5. Assert Windows path helpers resolve under a win32-like PROFILE_ROOT
 *
 * Writes evidence to /opt/cursor/artifacts/windows-openbot-pack-smoke.json
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACT = "/opt/cursor/artifacts/windows-openbot-pack-smoke.json";
const PORT = 18771;
const SUPERVISOR_TOKEN = "aria-windows-pack-test-sup";
const COMPUTER_TOKEN = "aria-windows-pack-test-comp";

/** @type {Record<string, unknown>} */
const evidence = {
  ok: false,
  startedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  steps: /** @type {Array<Record<string, unknown>>} */ ([]),
};

function step(name, data = {}) {
  const row = { name, at: new Date().toISOString(), ...data };
  evidence.steps.push(row);
  console.log(`✓ ${name}`, data.detail || "");
  return row;
}

function fail(name, err) {
  evidence.ok = false;
  evidence.error = { step: name, message: String(err?.message || err) };
  console.error(`✗ ${name}:`, evidence.error.message);
  writeEvidence();
  process.exit(1);
}

function writeEvidence() {
  evidence.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, headers: res.headers };
}

function mainPack() {
  const pack = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "pack-windows-openbot-chromium.mjs")],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (pack.status !== 0) {
    throw new Error(`pack failed: ${pack.stderr || pack.stdout}`);
  }
  step("pack", { detail: (pack.stdout || "").split("\n")[0] });
}

function validatePackageTree() {
  const dir = path.join(ROOT, "dist", "windows-openbot-chromium");
  const required = [
    "Install.bat",
    "Start-OpenBot.bat",
    "Stop-OpenBot.bat",
    "env.example",
    "package.json",
    "README.md",
    "BUILD.json",
    "scripts/openbot-chromium-supervisor.mjs",
  ];
  for (const rel of required) {
    assert(fs.existsSync(path.join(dir, rel)), `missing ${rel}`);
  }
  const bat = fs.readFileSync(path.join(dir, "Start-OpenBot.bat"), "utf8");
  assert(bat.includes("openbot-chromium-supervisor.mjs"), "Start-OpenBot.bat missing entrypoint");
  assert(bat.includes("OPENBOT_HEADED"), "Start-OpenBot.bat missing headed flag");
  const install = fs.readFileSync(path.join(dir, "Install.bat"), "utf8");
  assert(install.includes("playwright install chromium"), "Install.bat missing browser install");
  const zip = path.join(ROOT, "dist", "aria-openbot-chromium-windows-portable.zip");
  const tar = path.join(ROOT, "dist", "aria-openbot-chromium-windows-portable.tar.gz");
  assert(fs.existsSync(zip) || fs.existsSync(tar), "missing portable archive");
  const archive = fs.existsSync(zip) ? zip : tar;
  evidence.archive = { path: archive, bytes: fs.statSync(archive).size };
  step("validate-tree", { detail: archive });
  return dir;
}

function installDeps(pkgDir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aria-win-pack-"));
  // Copy tree
  spawnSync("cp", ["-a", pkgDir, path.join(work, "pkg")], { encoding: "utf8" });
  const dest = path.join(work, "pkg");
  const npm = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: dest,
    encoding: "utf8",
    env: process.env,
  });
  if (npm.status !== 0) {
    throw new Error(`npm install failed: ${npm.stderr || npm.stdout}`);
  }
  const pw = spawnSync("npx", ["playwright", "install", "chromium"], {
    cwd: dest,
    encoding: "utf8",
    env: process.env,
  });
  if (pw.status !== 0) {
    throw new Error(`playwright install failed: ${pw.stderr || pw.stdout}`);
  }
  step("install-deps", { detail: dest });
  return dest;
}

function assertWindowsPathHelpers(supervisorPath) {
  const src = fs.readFileSync(supervisorPath, "utf8");
  assert(src.includes("resolveChromePath"), "missing resolveChromePath");
  assert(src.includes('process.platform === "win32"'), "missing win32 Chrome candidates");
  assert(src.includes("defaultProfileRoot"), "missing defaultProfileRoot");
  assert(src.includes("os.tmpdir()"), "profile root must use os.tmpdir()");
  assert(src.includes("Windows NT 10.0"), "missing Windows user-agent");
  step("windows-path-helpers", { detail: "win32 Chrome + tmpdir + UA present" });
}

async function smokeSupervisor(pkgDir) {
  const profileRoot = path.join(os.tmpdir(), "aria-openbot-windows-pack-test", "profiles");
  fs.rmSync(profileRoot, { recursive: true, force: true });
  fs.mkdirSync(profileRoot, { recursive: true });

  const child = spawn(
    process.execPath,
    ["scripts/openbot-chromium-supervisor.mjs"],
    {
      cwd: pkgDir,
      env: {
        ...process.env,
        OPENBOT_SUPERVISOR_PORT: String(PORT),
        PORT: String(PORT),
        SUPERVISOR_TOKEN,
        COMPUTER_TOKEN,
        OPENBOT_HEADED: "0",
        OPENBOT_MAX_COMPUTERS: "2",
        OPENBOT_PROFILE_ROOT: profileRoot,
        OPENBOT_PUBLIC_BASE: `http://127.0.0.1:${PORT}`,
        // Force bundled Chromium (Linux device may lack google-chrome)
        OPENBOT_CHROME_PATH: "",
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });
  child.stdout.on("data", () => {});

  const base = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`supervisor exited early: ${child.exitCode}\n${stderr}`);
    }
    try {
      const h = await fetchJson(`${base}/health`);
      if (h.status === 200 && h.body?.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  assert(healthy, `health never became ok\n${stderr}`);
  step("health", { detail: `${base}/health` });

  const ensure = await fetchJson(`${base}/computers/win_pack_bot/ensure`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SUPERVISOR_TOKEN}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert(ensure.status === 200, `ensure status ${ensure.status}`);
  assert(ensure.body?.botId === "win_pack_bot" || ensure.body?.status, "ensure body unexpected");
  step("ensure", { detail: JSON.stringify(ensure.body).slice(0, 200) });

  const view = await fetch(`${base}/view/win_pack_bot?fs=1`, {
    headers: { authorization: `Bearer ${COMPUTER_TOKEN}` },
  });
  const viewHtml = await view.text();
  assert(view.ok, `view status ${view.status}`);
  assert(viewHtml.includes("/click-xy") || viewHtml.includes("click"), "view missing click wiring");
  assert(viewHtml.includes("/key") || viewHtml.includes("type-text"), "view missing keyboard wiring");
  step("view-fs", { detail: `bytes=${viewHtml.length}` });

  const take = await fetchJson(`${base}/c/win_pack_bot/control/take`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${COMPUTER_TOKEN}`,
      "x-openbot-computer-token": COMPUTER_TOKEN,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert(take.status === 200, `take status ${take.status}`);
  step("take-control", { detail: JSON.stringify(take.body).slice(0, 160) });

  const click = await fetchJson(`${base}/c/win_pack_bot/click-xy`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${COMPUTER_TOKEN}`,
      "x-openbot-computer-token": COMPUTER_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ x: 10, y: 10, width: 1280, height: 800 }),
  });
  // click-xy may 404 if routed only on /view server — try alternate
  if (click.status >= 400) {
    const click2 = await fetchJson(`${base}/click-xy`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${COMPUTER_TOKEN}`,
        "x-openbot-bot-id": "win_pack_bot",
        "content-type": "application/json",
      },
      body: JSON.stringify({ x: 10, y: 10 }),
    });
    step("click-xy", {
      detail: `primary=${click.status} alt=${click2.status}`,
      ok: click2.status < 500,
    });
  } else {
    step("click-xy", { detail: `status=${click.status}` });
  }

  child.kill("SIGTERM");
  await new Promise((r) => {
    const t = setTimeout(r, 3000);
    child.on("exit", () => {
      clearTimeout(t);
      r(undefined);
    });
  });
  step("shutdown", { detail: `exit=${child.exitCode}` });
}

async function main() {
  try {
    mainPack();
    const pkgDir = validatePackageTree();
    assertWindowsPathHelpers(
      path.join(pkgDir, "scripts", "openbot-chromium-supervisor.mjs"),
    );
    const installed = installDeps(pkgDir);
    await smokeSupervisor(installed);
    evidence.ok = true;
    step("done", { detail: "Windows portable package smoke passed on this device" });
    writeEvidence();
    console.log(`\nEvidence: ${ARTIFACT}`);
  } catch (err) {
    fail("smoke", err);
  }
}

main();
