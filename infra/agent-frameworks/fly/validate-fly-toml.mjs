/**
 * Offline Fly role-config check. Quality must not call `flyctl config validate`
 * (that command requires a Fly account). Do not add FLY_API_TOKEN here.
 */

const ALLOWED_TOP = new Set([
  "app",
  "primary_region",
  "kill_signal",
  "kill_timeout",
  "deploy",
  "env",
  "files",
  "mounts",
  "vm",
  "restart",
  "checks",
]);

const FORBIDDEN_TOP = new Set(["services", "service", "http_service", "build"]);

function parseTomlValue(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  throw new Error(`unsupported TOML value: ${raw}`);
}

export function parseFlyTomlSubset(text) {
  const root = {};
  let current = root;
  const lines = String(text ?? "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;

    const arrayTable = line.match(/^\[\[([^[\]]+)\]\]$/);
    if (arrayTable) {
      const key = arrayTable[1].trim();
      if (!Array.isArray(root[key])) root[key] = [];
      const row = {};
      root[key].push(row);
      current = row;
      continue;
    }

    const table = line.match(/^\[([^[\]]+)\]$/);
    if (table) {
      const parts = table[1].trim().split(".");
      current = root;
      for (const part of parts) {
        if (typeof current[part] !== "object" || current[part] === null || Array.isArray(current[part])) {
          current[part] = {};
        }
        current = current[part];
      }
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!kv) throw new Error(`invalid TOML line: ${line}`);
    current[kv[1]] = parseTomlValue(kv[2].trim());
  }
  return root;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  return value;
}

export function validateFlyRoleToml(source, role = "fly-role") {
  const parsed = parseFlyTomlSubset(source);
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_TOP.has(key)) {
      throw new Error(`${role}: Fly Proxy / build surface '${key}' is forbidden`);
    }
    if (!ALLOWED_TOP.has(key)) {
      throw new Error(`${role}: unknown Fly config key '${key}'`);
    }
  }

  const app = requireString(parsed.app, `${role}.app`);
  if (!/^aria-mantu-[a-z0-9-]+$/.test(app)) {
    throw new Error(`${role}: app must be an aria-mantu-* Fly app name`);
  }
  if (parsed.primary_region !== "cdg") {
    throw new Error(`${role}: primary_region must be cdg`);
  }
  requireString(parsed.kill_signal, `${role}.kill_signal`);
  requireNumber(parsed.kill_timeout, `${role}.kill_timeout`);

  const deploy = parsed.deploy;
  if (!deploy || typeof deploy !== "object" || Array.isArray(deploy)) {
    throw new Error(`${role}: [deploy] is required`);
  }
  if (deploy.strategy !== "rolling") {
    throw new Error(`${role}: deploy.strategy must be rolling`);
  }
  requireString(deploy.wait_timeout, `${role}.deploy.wait_timeout`);

  const env = parsed.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error(`${role}: [env] is required`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      throw new Error(`${role}.env.${key} must be a string`);
    }
  }

  for (const file of parsed.files ?? []) {
    requireString(file.guest_path, `${role}.files.guest_path`);
    requireString(file.secret_name, `${role}.files.secret_name`);
  }

  for (const mount of parsed.mounts ?? []) {
    requireString(mount.source, `${role}.mounts.source`);
    requireString(mount.destination, `${role}.mounts.destination`);
    requireString(mount.initial_size, `${role}.mounts.initial_size`);
    requireNumber(mount.snapshot_retention, `${role}.mounts.snapshot_retention`);
    if (mount.scheduled_snapshots !== true) {
      throw new Error(`${role}: mounts.scheduled_snapshots must be true`);
    }
    requireNumber(mount.auto_extend_size_threshold, `${role}.mounts.auto_extend_size_threshold`);
    requireString(mount.auto_extend_size_increment, `${role}.mounts.auto_extend_size_increment`);
    requireString(mount.auto_extend_size_limit, `${role}.mounts.auto_extend_size_limit`);
  }

  for (const vm of requireArray(parsed.vm, `${role}.[[vm]]`)) {
    requireString(vm.size, `${role}.vm.size`);
    requireString(vm.memory, `${role}.vm.memory`);
    if (vm.persist_rootfs !== "never") {
      throw new Error(`${role}: vm.persist_rootfs must be never`);
    }
  }

  for (const restart of requireArray(parsed.restart, `${role}.[[restart]]`)) {
    if (restart.policy !== "always") {
      throw new Error(`${role}: restart.policy must be always`);
    }
  }

  const checks = parsed.checks;
  if (checks !== undefined) {
    if (typeof checks !== "object" || Array.isArray(checks)) {
      throw new Error(`${role}: [checks] must be a table`);
    }
    for (const [name, check] of Object.entries(checks)) {
      if (!check || typeof check !== "object" || Array.isArray(check)) {
        throw new Error(`${role}: checks.${name} must be a table`);
      }
      if (check.type !== "tcp" && check.type !== "http") {
        throw new Error(`${role}: checks.${name}.type must be tcp or http`);
      }
      requireNumber(check.port, `${role}.checks.${name}.port`);
      requireString(check.interval, `${role}.checks.${name}.interval`);
      requireString(check.timeout, `${role}.checks.${name}.timeout`);
      requireString(check.grace_period, `${role}.checks.${name}.grace_period`);
    }
  }

  return parsed;
}
