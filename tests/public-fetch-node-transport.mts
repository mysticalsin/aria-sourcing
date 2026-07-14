import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureDir = mkdtempSync(join(tmpdir(), "aria-public-fetch-tls-"));
const keyPath = join(fixtureDir, "key.pem");
const certPath = join(fixtureDir, "cert.pem");

try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const worker = spawnSync(
    process.execPath,
    ["--import", "tsx", "tests/helpers/public-fetch-node-transport-worker.mts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: certPath,
        PUBLIC_FETCH_TEST_KEY: keyPath,
        PUBLIC_FETCH_TEST_CERT: certPath,
      },
    },
  );
  process.stdout.write(worker.stdout);
  process.stderr.write(worker.stderr);
  if (worker.status !== 0) process.exitCode = worker.status ?? 1;
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
