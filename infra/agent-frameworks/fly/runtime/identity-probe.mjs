import fs from "node:fs";

function required(value, name) {
  if (typeof value !== "string" || value.length < 1 || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function token(file) {
  const value = fs.readFileSync(required(file, "secret file"), "utf8").trim();
  if (value.length < 32 || /\s/.test(value)) throw new Error("secret material is invalid");
  return value;
}

function privateUrl(port, pathname) {
  const address = required(process.env.FLY_PRIVATE_IP, "FLY_PRIVATE_IP");
  if (!address.startsWith("fdaa:")) throw new Error("private address is invalid");
  return `http://[${address}]:${port}${pathname}`;
}

async function request(url, options = {}, asText = false) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("readiness probe failed");
  return asText ? response.text() : response.json();
}

async function main() {
  const mode = required(process.argv[2], "probe mode");
  if (mode === "model-gateway") {
    const body = await request(privateUrl(8090, "/readyz"), {
      headers: { authorization: `Bearer ${token(process.env.MODEL_GATEWAY_INTERNAL_TOKEN_FILE)}` },
    });
    if (
      body?.status !== "ready" ||
      body?.provider !== process.env.MODEL_GATEWAY_PROVIDER_ID ||
      body?.model !== process.env.MODEL_GATEWAY_MODEL_ID
    ) throw new Error("model gateway identity mismatch");
    return { mode, status: "ready", provider: body.provider, model: body.model };
  }
  if (mode === "adapter") {
    const framework = required(process.env.ADAPTER_MODE, "ADAPTER_MODE");
    const contract = framework === "deerflow" ? "aria.deerflow.run.v1" : "aria.flowise.import.v1";
    const body = await request(privateUrl(8080, "/readyz"), {
      headers: {
        authorization: `Bearer ${token(process.env.ADAPTER_TOKEN_FILE)}`,
        "x-aria-framework-contract": contract,
        "x-aria-workspace-id": required(process.env.ARIA_WORKSPACE_ID, "workspace"),
        "x-aria-framework-instance-id": required(process.env.FRAMEWORK_INSTANCE_ID, "instance"),
      },
    });
    const expected = {
      framework,
      contract,
      sourceCommit: process.env.UPSTREAM_SOURCE_COMMIT,
      imageDigest: process.env.UPSTREAM_IMAGE_DIGEST,
      configurationSha256: process.env.AGENT_FRAMEWORK_CONFIGURATION_SHA256,
      workspaceId: process.env.ARIA_WORKSPACE_ID,
      frameworkInstanceId: process.env.FRAMEWORK_INSTANCE_ID,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (body?.[key] !== value) throw new Error("adapter identity mismatch");
    }
    if (body?.ok !== true || !body.dependencies || Object.values(body.dependencies).some((value) => value !== true)) {
      throw new Error("adapter dependencies are not ready");
    }
    return { mode, status: "ready", ...expected, dependencies: body.dependencies };
  }
  if (mode === "deerflow") {
    const body = await request(privateUrl(8001, "/health"));
    if (body?.status !== "healthy" || body?.service !== "deer-flow-gateway") throw new Error("DeerFlow is not ready");
    return { mode, status: "ready" };
  }
  if (mode === "flowise") {
    const body = (await request(privateUrl(3000, "/api/v1/ping"), {}, true)).trim();
    if (body !== "pong") throw new Error("Flowise is not ready");
    return { mode, status: "ready" };
  }
  if (mode === "flowise-worker") {
    const body = await request("http://127.0.0.1:5566/healthz");
    const queueName = required(process.env.QUEUE_NAME, "QUEUE_NAME");
    if (
      !hasExactKeys(body, ["schema", "status", "queueName", "database", "queue", "worker"]) ||
      body.schema !== "aria.flowise-worker-readiness.v1" ||
      body.status !== "ready" ||
      body.queueName !== queueName ||
      body.database !== true ||
      body.queue !== true ||
      body.worker !== true
    ) throw new Error("Flowise worker is not ready");
    return { mode, status: "ready", queueName };
  }
  throw new Error("probe mode is invalid");
}

try {
  process.stdout.write(`${JSON.stringify(await main())}\n`);
} catch {
  process.stderr.write("Private readiness probe failed closed.\n");
  process.exitCode = 1;
}
