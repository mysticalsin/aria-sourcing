import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "aria-build-"));
const sourceDirectories = ["src", "public"];
const projectFiles = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "next-env.d.ts",
  "tsconfig.json",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
];

function copyIntoIsolatedRoot(relativePath) {
  const source = path.join(projectRoot, relativePath);
  if (!existsSync(source)) return Promise.resolve();
  return cp(source, path.join(isolatedRoot, relativePath), { recursive: true });
}

try {
  await Promise.all([...sourceDirectories, ...projectFiles].map(copyIntoIsolatedRoot));

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const installEnv = { ...process.env };
  delete installEnv.NEXT_DIST_DIR;
  execFileSync(
    npm,
    [
      "ci",
      "--no-audit",
      "--no-fund",
      "--prefer-offline",
      "--fetch-retries=2",
      "--fetch-timeout=30000",
    ],
    {
      cwd: isolatedRoot,
      env: installEnv,
      stdio: "inherit",
    },
  );

  const buildEnv = { ...installEnv, NEXT_TELEMETRY_DISABLED: "1" };
  delete buildEnv.NEXT_DIST_DIR;
  execFileSync(npm, ["run", "build"], {
    cwd: isolatedRoot,
    env: buildEnv,
    stdio: "inherit",
  });
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
