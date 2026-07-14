import { readFileSync, existsSync, readdirSync } from "fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const readme = source("README.md");
const envLocal = source(".env.local.example");
const documentationMap = source("docs/README.md");
const deploymentRunbook = source("production-readiness/DEPLOYMENT_RUNBOOK.md");
const architecture = source("docs/ARCHITECTURE.md");
const releaseWorkflow = source(".github/workflows/deploy-aria-mantu.yml");
const dockerGuide = source("DOCKER.md");
const dockerCompose = source("docker-compose.yml");
const supabaseSetup = source("SUPABASE_SETUP.md");
const localSetup = source("production-readiness/LOCAL_SETUP.md");
const legacyRootBaton = source("CLAUDE_RELAY_BATON.md");
const agentInstructions = source("AGENTS.md");
const inventory = source("production-readiness/INVENTORY.md");
const dataFlow = source("production-readiness/DATA_FLOW.md");
const allDocs = [
  "README.md",
  "DEPLOYMENT.md",
  "SUPABASE_SETUP.md",
  "production-readiness/DEPLOYMENT_RUNBOOK.md",
  "production-readiness/DEPLOY_CHECKLIST.md",
  "production-readiness/LOCAL_SETUP.md",
  "production-readiness/STATUS.md",
].map((path) => `${path}\n${source(path)}`).join("\n\n");

ok("README does not claim Next.js 14", !readme.includes("Next.js 14"));
ok("README does not claim React 18", !readme.includes("React 18"));
ok(".env.local.example contains TAVILY_API_KEY", envLocal.includes("TAVILY_API_KEY"));
ok(".env.local.example contains DATA_ENCRYPTION_KEY", envLocal.includes("DATA_ENCRYPTION_KEY"));
ok("docs do not say migrations stop at 0001-0005", !/apply migrations 0001[-–]0005/i.test(allDocs));
ok("docs do not say migrations stop at 0001-0012", !/apply migrations 0001[-–]0012/i.test(allDocs));
ok("docs do not say through 0005 as the full set", !/through 0005/i.test(allDocs));
ok("docs do not say through 0012 as the full set", !/through 0012/i.test(allDocs));
ok("STATUS.md exists", existsSync(new URL("../production-readiness/STATUS.md", import.meta.url)));
const status = source("production-readiness/STATUS.md");
const statusDate = status.match(/\*\*Date:\*\*\s+(\d{4}-\d{2}-\d{2})/)?.[1];
const statusDateMs = statusDate ? Date.parse(`${statusDate}T00:00:00Z`) : Number.NaN;
const ageDays = (Date.now() - statusDateMs) / (24 * 60 * 60 * 1000);
ok(
  "STATUS.md contains a recent, non-future ISO date",
  Number.isFinite(statusDateMs) && ageDays >= -1 && ageDays <= 31,
);

function workflowComponents(name: string): string[] {
  const encoded = releaseWorkflow.match(
    new RegExp(`const ${name} = (\\[[^;]+\\]);`),
  )?.[1];
  if (!encoded) return [];
  const parsed = JSON.parse(encoded) as unknown;
  return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
    ? parsed
    : [];
}

const scannedComponents = workflowComponents("scannedComponents");
const attestedComponents = workflowComponents("attestedComponents");
const supplyChainDocs = [readme, status, deploymentRunbook, architecture];
ok(
  "release docs derive scanned and locally attested image totals from the workflow",
  scannedComponents.length > 0
    && attestedComponents.length > 0
    && supplyChainDocs.every((document) =>
      document.includes(`${scannedComponents.length} images`)
      && document.includes(`${attestedComponents.length} local`)
      && document.includes("Graphify")),
);

const legacyTableInventory = source("docker/bootstrap/legacy-table-inventory.txt")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
ok(
  "runbook derives legacy table coverage from the canonical inventory",
  legacyTableInventory.length > 0
    && deploymentRunbook.includes("docker/bootstrap/legacy-table-inventory.txt")
    && !/\b\d+\s+(?:reviewed public\s+)?application tables\b/i.test(deploymentRunbook),
);

const packageJson = JSON.parse(source("package.json")) as {
  description?: string;
  scripts?: Record<string, string>;
};
const countCommands = (script: string | undefined) => script?.split(/\s+&&\s+/).length ?? 0;
const canonicalTestCommands =
  countCommands(packageJson.scripts?.pretest)
  + countCommands(packageJson.scripts?.test)
  + countCommands(packageJson.scripts?.posttest);
const pretestCommands = countCommands(packageJson.scripts?.pretest);
const testCommands = countCommands(packageJson.scripts?.test);
const posttestCommands = countCommands(packageJson.scripts?.posttest);
ok(
  "STATUS.md reports the package-derived top-level lifecycle command count",
  canonicalTestCommands > 0 && status.includes(`${canonicalTestCommands} top-level lifecycle commands`),
);
ok(
  "README reports the package-derived top-level lifecycle command count",
  canonicalTestCommands > 0 && readme.includes(`${canonicalTestCommands} top-level lifecycle commands`),
);
ok(
  "package description names the current product instead of the old mock MVP",
  Boolean(packageJson.description) &&
    !/MVP demo|mock integrations|synthetic data/i.test(packageJson.description ?? ""),
);

const architecturePath = new URL("../docs/ARCHITECTURE.md", import.meta.url);
const readinessIndexPath = new URL("../production-readiness/README.md", import.meta.url);
const contributingPath = new URL("../CONTRIBUTING.md", import.meta.url);
const securityPath = new URL("../SECURITY.md", import.meta.url);
const testingPath = new URL("../docs/TESTING.md", import.meta.url);
const flySizingPath = new URL("../docs/operations/FLY_SIZING.md", import.meta.url);
ok("current architecture guide exists", existsSync(architecturePath));
ok("production-readiness index exists", existsSync(readinessIndexPath));
ok("contributor guide exists", existsSync(contributingPath));
ok("security guide exists", existsSync(securityPath));
ok("testing guide exists", existsSync(testingPath));
ok("Fly sizing guide exists", existsSync(flySizingPath));
const developerMapPaths = [
  "src/lib/README.md",
  "tests/README.md",
  "scripts/README.md",
  "infra/README.md",
  "docs/OWNERSHIP.md",
];
ok(
  "developer maps exist for logic, tests, scripts, infrastructure, and ownership",
  developerMapPaths.every((path) =>
    existsSync(new URL(`../${path}`, import.meta.url)),
  ),
);
ok(
  "primary developer entrypoints link every developer map",
  [
    [readme, developerMapPaths],
    [
      documentationMap,
      [
        "../src/lib/README.md",
        "../tests/README.md",
        "../scripts/README.md",
        "../infra/README.md",
        "OWNERSHIP.md",
      ],
    ],
    [
      architecture,
      [
        "../src/lib/README.md",
        "../tests/README.md",
        "../scripts/README.md",
        "../infra/README.md",
        "OWNERSHIP.md",
      ],
    ],
  ].every(([document, links]) =>
    (links as string[]).every((link) => (document as string).includes(link)),
  ),
);
ok(
  "documentation map points to the current architecture guide",
  documentationMap.includes("docs/ARCHITECTURE.md") &&
    !/production-readiness\/ARCHITECTURE\.md[^\n]*architecture of record/i.test(documentationMap),
);
ok(
  "documentation map points to the production-readiness index",
  documentationMap.includes("production-readiness/README.md"),
);
ok(
  "documentation map points to contributor, security, and testing guides",
  documentationMap.includes("CONTRIBUTING.md") &&
    documentationMap.includes("SECURITY.md") &&
    documentationMap.includes("docs/TESTING.md"),
);
const rootDeployment = source("DEPLOYMENT.md");
ok(
  "root deployment guide stays a short authority map",
  rootDeployment.length < 2_000 &&
    rootDeployment.includes("production-readiness/DEPLOYMENT_RUNBOOK.md") &&
    rootDeployment.includes("docs/operations/FLY_SIZING.md") &&
    !/Structural next step|collapse the four Supabase VMs/i.test(rootDeployment),
);
ok(
  "STATUS distinguishes inbound review queue from agent graph run history",
  /Inbound candidate repl(?:y|ies)[^.]*named human review/i.test(status) &&
    /Agent graph drafts[^.]*run history[^.]*no delivery authority/i.test(status),
);
ok(
  "STATUS does not claim every generated candidate reply enters a review queue",
  !/every generated candidate reply enters named\s+human review/i.test(status),
);

ok(
  "deployment runbook reports the package-derived pretest and test command counts",
  deploymentRunbook.includes(
    `${pretestCommands} pretest + ${testCommands} test + ${posttestCommands} posttest commands`,
  ),
);
const migrationFiles = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();
const latestMigration = migrationFiles.at(-1) ?? "";
ok(
  "deployment runbook includes the current migration tip",
  Boolean(latestMigration) && deploymentRunbook.includes(latestMigration),
);

const composeAppPort = dockerCompose.match(/\$\{APP_PORT:-(\d+)\}:3000/)?.[1];
const composeGoTrueSitePort = dockerCompose.match(/GOTRUE_SITE_URL:\s*http:\/\/localhost:(\d+)/)?.[1];
ok(
  "Compose app host port matches the GoTrue site URL",
  Boolean(composeAppPort) && composeAppPort === composeGoTrueSitePort,
);
ok(
  "Docker guide opens the actual default Compose app port",
  Boolean(composeAppPort) && dockerGuide.includes(`http://localhost:${composeAppPort}`),
);
ok(
  "Docker guide does not hard-code an obsolete migration range",
  !/applies migrations?\s+`?\d{4}`?\s+(?:through|to|-)\s+`?\d{4}`?/i.test(dockerGuide),
);
ok(
  "Supabase setup does not claim live workspaces receive synthetic seed data",
  !/workspace is created[\s\S]{0,100}synthetic demo data/i.test(supabaseSetup),
);
ok(
  "Supabase setup does not present the shared document as the long-term authority model",
  !/document model is the fast, safe default; normalize when/i.test(supabaseSetup),
);
ok(
  "local setup stays procedural instead of carrying undated completion claims",
  !/^## Status$/m.test(localSetup) && !/[✅⏳]/u.test(localSetup),
);
ok(
  "legacy root baton is a short compatibility pointer to the current Relay",
  legacyRootBaton.length < 1_000 &&
    legacyRootBaton.includes("_relay/HANDOFF.md") &&
    !/Next\.js 14|React 18|17 test files|uncommitted changes/i.test(legacyRootBaton),
);
ok(
  "agent instructions do not freeze a stale suite count",
  !/\d+ suites,\s*0 failures as of/i.test(agentInstructions) &&
    agentInstructions.includes("package.json"),
);
ok(
  "production inventory does not classify sourcing as mock-only",
  !/\*\*Mock-only[^\n]*\*\*[^\n]*sourcing/i.test(inventory) &&
    !/Sourcing returns synthetic candidates\s+from `src\/lib\/mock-ai\.ts`/i.test(inventory),
);
ok(
  "data-flow report describes the current live sourcing authority path",
  /\/api\/sourcing-agent/.test(dataFlow) &&
    /real provider/i.test(dataFlow) &&
    !/current implementation this calls `sourceCandidates\(\)`/i.test(dataFlow),
);

console.log(`RESULT docs-truth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
