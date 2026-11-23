/**
 * Browser proof for Recruiter System Connect against a local stub.
 * Synthetic data only. Does not open linkedin.com.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const TOKEN = "synthetic-rsc-bearer";
let appPort = 4187;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function startStub(): Promise<{ server: Server; url: string; hits: { count: number } }> {
  const hits = { count: 0 };
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const authorized = req.method === "POST" && req.headers.authorization === `Bearer ${TOKEN}`;
    if (!authorized) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    const parsed = JSON.parse(body) as { source?: string; query?: string };
    if (parsed.source !== "recruiter-system-connect" || parsed.query !== "staff engineer paris") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    hits.count += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        results: [
          {
            name: "Ada Synthetic",
            role: "Staff Engineer",
            location: "Paris",
            text: "Staff engineer in Paris. Skills: TypeScript.",
            skills: ["TypeScript", "NotInText"],
          },
          { name: "No Signal", role: "", location: "Lyon", text: "Just a bio.", skills: ["Ghost"] },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub failed to bind");
  return { server, url: `http://127.0.0.1:${address.port}/rsc`, hits };
}

function scrub(text: string): string {
  return text.split(TOKEN).join("[redacted]");
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "not ready";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`app did not become healthy: ${scrub(last)}`);
}

async function ensureNoNext(): Promise<void> {
  for (const pattern of ["next dev", "next-server"]) {
    try {
      execFileSync("pkill", ["-f", pattern], { stdio: "ignore" });
    } catch {
      // Nothing matched.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  rmSync(".next/dev/lock", { force: true });
}

function startApp(port: number, env: Record<string, string | undefined>): ChildProcess {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, PORT: String(port) };
  delete childEnv.NEXT_PUBLIC_SUPABASE_URL;
  delete childEnv.SUPABASE_URL;
  delete childEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete childEnv.NEXT_PUBLIC_ENABLE_DEMO_LOGIN;
  const child = spawn("npx", ["next", "dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(),
    env: childEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    const line = scrub(chunk.toString("utf8"));
    if (/error/i.test(line)) process.stdout.write(line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(scrub(chunk.toString("utf8")));
  });
  return child;
}

async function stopApp(child: ChildProcess): Promise<void> {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await ensureNoNext();
}

async function assertNoToken(page: Page, origin: string): Promise<void> {
  const html = await page.content();
  if (html.includes(TOKEN)) throw new Error("token echoed to the page");
  const status = await page.request.get(`${origin}/api/linkedin/connect`);
  const body = await status.text();
  if (body.includes(TOKEN)) throw new Error("token echoed by the connect API");
}

async function runScenario(name: string, env: Record<string, string | undefined>, check: (page: Page) => Promise<void>): Promise<void> {
  await ensureNoNext();
  const port = appPort++;
  const child = startApp(port, env);
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    await waitForHealth(port);
    const page = await browser.newPage();
    const home = await page.request.get(`http://127.0.0.1:${port}/`);
    if (!home.ok()) throw new Error(`${name}: home did not boot (${home.status()})`);
    await page.goto(`http://127.0.0.1:${port}/settings#linkedin-rsc-connect`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.getByTestId("linkedin-rsc-connect").waitFor({ timeout: 60_000 });
    const skip = page.getByRole("button", { name: "Skip", exact: true });
    if (await skip.count()) {
      await skip.click();
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10_000 });
    }
    await check(page);
    await assertNoToken(page, `http://127.0.0.1:${port}`);
    console.log(`PASS ${name}`);
  } finally {
    await browser.close();
    await stopApp(child);
  }
}

async function sourceTwice(page: Page, expected: string): Promise<void> {
  for (let run = 0; run < 2; run++) {
    await page.getByTestId("linkedin-rsc-source").click();
    await page.getByTestId("linkedin-rsc-results").getByText(expected).waitFor({ timeout: 30_000 });
  }
}

const stub = await startStub();
try {
  await runScenario("disconnected", { LINKEDIN_RSC_URL: "", LINKEDIN_RSC_TOKEN: "" }, async (page) => {
    await page.getByTestId("linkedin-rsc-state").filter({ hasText: "Not connected" }).waitFor();
    await page.getByTestId("linkedin-token-channel-state").filter({ hasText: "Not connected" }).waitFor();
    await sourceTwice(page, "Mina Local");
    const note = await page.getByTestId("linkedin-rsc-source-note").innerText();
    if (!note.includes("not connected")) throw new Error("disconnected note missing");
  });

  await runScenario("refused-page-url", {
    LINKEDIN_RSC_URL: "https://www.linkedin.com/in/synthetic-profile",
    LINKEDIN_RSC_TOKEN: TOKEN,
  }, async (page) => {
    await page.getByTestId("linkedin-rsc-state").filter({ hasText: "Not connected" }).waitFor();
    await page.getByText("That address is a linkedin.com page.").waitFor();
    await sourceTwice(page, "Mina Local");
    const html = await page.content();
    if (html.includes("Ada Synthetic")) throw new Error("refused URL returned stub results");
  });

  await runScenario("stub-rsc", {
    LINKEDIN_RSC_URL: stub.url,
    LINKEDIN_RSC_TOKEN: TOKEN,
  }, async (page) => {
    await page.getByTestId("linkedin-rsc-state").filter({ hasText: "Connected" }).waitFor();
    const host = new URL(stub.url).host;
    await page.getByText(`API host ${host}`).waitFor();
    await sourceTwice(page, "Ada Synthetic");
    await page.getByText("Mina Local").waitFor();
    const html = await page.content();
    if (html.includes("NotInText") || html.includes("No Signal")) throw new Error("quality bar did not hold in the UI");
  });

  if (stub.hits.count < 2) throw new Error(`stub received ${stub.hits.count} calls, expected at least 2`);
  console.log(`PASS stub-hits ${stub.hits.count}`);
} finally {
  await new Promise<void>((resolve) => stub.server.close(() => resolve()));
}
