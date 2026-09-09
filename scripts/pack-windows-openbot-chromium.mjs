#!/usr/bin/env node
/**
 * Build a Windows portable zip for the OpenBot Chromium supervisor.
 *
 * Output:
 *   dist/windows-openbot-chromium/          unpackaged tree
 *   dist/aria-openbot-chromium-windows-portable.zip
 *
 * Does not embed node_modules (Windows runs Install.bat). Copies the latest
 * supervisor script from scripts/ so the zip matches git tip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages", "windows-openbot-chromium");
const OUT_DIR = path.join(ROOT, "dist", "windows-openbot-chromium");
const ZIP_PATH = path.join(
  ROOT,
  "dist",
  "aria-openbot-chromium-windows-portable.zip",
);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing package template: ${SRC}`);
    process.exit(1);
  }
  const supervisorSrc = path.join(ROOT, "scripts", "openbot-chromium-supervisor.mjs");
  if (!fs.existsSync(supervisorSrc)) {
    console.error(`Missing supervisor: ${supervisorSrc}`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  rmrf(OUT_DIR);
  fs.mkdirSync(path.join(OUT_DIR, "scripts"), { recursive: true });

  const rootFiles = [
    "package.json",
    "README.md",
    "Install.bat",
    "Start-OpenBot.bat",
    "Stop-OpenBot.bat",
    "env.example",
  ];
  for (const name of rootFiles) {
    copyFile(path.join(SRC, name), path.join(OUT_DIR, name));
  }
  copyFile(supervisorSrc, path.join(OUT_DIR, "scripts", "openbot-chromium-supervisor.mjs"));

  // Stamp build metadata (no secrets).
  const meta = {
    builtAt: new Date().toISOString(),
    source: "packages/windows-openbot-chromium",
    supervisor: "scripts/openbot-chromium-supervisor.mjs",
    platformTarget: "win32-x64",
    nodeEngine: ">=20",
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "BUILD.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );

  rmrf(ZIP_PATH);
  const zip = spawnSync(
    "zip",
    ["-r", "-q", ZIP_PATH, "windows-openbot-chromium"],
    { cwd: path.join(ROOT, "dist"), encoding: "utf8" },
  );
  if (zip.status !== 0) {
    // Fallback without system zip: tar.gz (Windows can open via 7zip; also keep zip try)
    console.warn("zip unavailable or failed; writing tar.gz fallback");
    const tarPath = ZIP_PATH.replace(/\.zip$/, ".tar.gz");
    rmrf(tarPath);
    const tar = spawnSync(
      "tar",
      ["-czf", tarPath, "-C", path.join(ROOT, "dist"), "windows-openbot-chromium"],
      { encoding: "utf8" },
    );
    if (tar.status !== 0) {
      console.error(zip.stderr || tar.stderr || "pack failed");
      process.exit(1);
    }
    console.log(`Packed ${tarPath}`);
    printManifest(OUT_DIR, tarPath);
    return;
  }

  console.log(`Packed ${ZIP_PATH}`);
  printManifest(OUT_DIR, ZIP_PATH);
}

function printManifest(dir, archive) {
  const files = [];
  function walk(d, prefix = "") {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = path.join(prefix, ent.name);
      if (ent.isDirectory()) walk(path.join(d, ent.name), rel);
      else files.push(rel.replaceAll("\\", "/"));
    }
  }
  walk(dir);
  const st = fs.statSync(archive);
  console.log(
    JSON.stringify(
      {
        archive,
        bytes: st.size,
        files,
      },
      null,
      2,
    ),
  );
}

main();
