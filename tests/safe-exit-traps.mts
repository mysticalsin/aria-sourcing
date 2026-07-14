import { spawn } from "node:child_process";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

async function signalProbe(signal: "SIGINT" | "SIGTERM", expectedCode: number) {
  const script = `
    source scripts/lib/safe-exit-traps.sh
    cleanup_probe() {
      code=$?
      trap - EXIT INT TERM
      printf 'CLEANUP:%s\\n' "$code"
      exit "$code"
    }
    install_safe_exit_traps cleanup_probe
    printf 'READY\\n'
    while :; do :; done
  `;
  const child = spawn("/bin/bash", ["-c", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let signalSent = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (!signalSent && output.includes("READY\n")) {
      signalSent = true;
      child.kill(signal);
    }
  });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${signal} probe timed out`)); }, 5_000);
    child.on("error", reject);
    child.on("exit", (exitCode) => { clearTimeout(timeout); resolve(exitCode); });
  });
  ok(`${signal} exits ${expectedCode}`, code === expectedCode);
  ok(`${signal} runs EXIT cleanup with ${expectedCode}`, output.includes(`CLEANUP:${expectedCode}`));
}

await signalProbe("SIGINT", 130);
await signalProbe("SIGTERM", 143);

console.log(`RESULT safe-exit-traps: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
