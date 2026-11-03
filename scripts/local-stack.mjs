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
const compose = (args, options = {}) => spawnSync("docker", ["compose", "-f", "docker-compose.yml", ...args], { cwd: root, encoding: "utf8", ...options });
const appPort = process.env.APP_PORT || "3000";
const apiPort = process.env.API_PORT || "54321";

/** On a running stack: the gateway contract from inside the network, then the
 *  two host ports the browser uses. Read-only; returns false on the first failure. */
async function checkRunningStack() {
  const running = compose(["ps", "--status", "running", "--services"]).stdout?.split(/\s+/) ?? [];
  if (!running.includes("gateway")) {
    console.log("Configuration is valid. The stack is not running: start it with npm run demo:up, then run doctor again.");
    return true;
  }
  const contract = compose(["run", "--rm", "--no-deps", "--entrypoint", "/usr/local/bin/gateway-check.sh", "supabase-bootstrap"], { stdio: "inherit" });
  if (contract.status !== 0) return false;
  for (const [label, url, hint] of [
    ["API gateway on the host", `http://localhost:${apiPort}/gateway-health`, "docker compose logs gateway"],
    ["App readiness", `http://localhost:${appPort}/api/ready`, "docker compose logs app"],
  ]) {
    const status = await fetch(url, { signal: AbortSignal.timeout(10_000) }).then((r) => r.status, () => 0);
    if (status !== 200) {
      console.error(`[doctor] FAIL ${label}: ${url} -> ${status || "unreachable"}. Check: ${hint}`);
      return false;
    }
    console.log(`[doctor] ok   ${label}: ${url}`);
  }
  return true;
}

const daemon = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { cwd: root, encoding: "utf8" });
if (daemon.error || daemon.status !== 0) {
  console.error("Docker Engine is unavailable. Install/start Docker Desktop (WSL 2 on Windows), then retry. Existing data and .env.local were not changed.");
  process.exitCode = 1;
} else {
  // Health checks use start_interval, which older engines ignore (slow first boot).
  const engineMajor = Number.parseInt(daemon.stdout, 10);
  if (engineMajor < 25) console.warn(`[doctor] Docker Engine ${daemon.stdout.trim()} is older than 25: update Docker Desktop for faster startup checks.`);
  const result = compose(commands[command], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
  if (result.status === 0 && command === "up") console.log("Local workspace ready. Open http://localhost:" + appPort + "/login. Stop preserves both database and encryption-key volumes.");
  if (result.status === 0 && command === "doctor" && !(await checkRunningStack())) process.exitCode = 1;
}
