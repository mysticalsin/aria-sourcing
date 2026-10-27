import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "status";
const commands = {
  up: ["up", "--build", "--detach", "--wait", "--wait-timeout", "300"],
  stop: ["down"],
  restart: ["restart", "app"],
  status: ["ps", "--all"],
  doctor: ["config", "--quiet"],
};
if (!Object.hasOwn(commands, command)) throw new Error("Use up, stop, restart, status, or doctor. No command deletes volumes.");
const daemon = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { cwd: root, encoding: "utf8" });
if (daemon.error || daemon.status !== 0) {
  console.error("Docker Engine is unavailable. Install/start Docker Desktop (WSL 2 on Windows), then retry. Existing data and .env.local were not changed.");
  process.exitCode = 1;
} else {
  const result = spawnSync("docker", ["compose", "-f", "docker-compose.yml", ...commands[command]], { cwd: root, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
  if (result.status === 0 && command === "up") console.log("Local workspace ready. Open http://localhost:" + (process.env.APP_PORT || "3000") + "/login. Stop preserves both database and encryption-key volumes.");
}
