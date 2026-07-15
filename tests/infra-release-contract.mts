import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const deploy = readFileSync("deploy-fly.sh", "utf8");
const bootstrap = readFileSync("docker/bootstrap/run.fly.sh", "utf8");
const bootstrapImage = readFileSync("docker/bootstrap/Dockerfile.fly", "utf8");
const deployWorkflow = readFileSync(".github/workflows/deploy-aria-mantu.yml", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const codeqlWorkflow = readFileSync(".github/workflows/codeql.yml", "utf8");
const appFlyConfig = readFileSync("fly.app.toml", "utf8");
const dbFlyConfig = readFileSync("fly.db.toml", "utf8");
const authFlyConfig = readFileSync("fly.auth.toml", "utf8");
const restFlyConfig = readFileSync("fly.rest.toml", "utf8");
const readinessRoute = readFileSync("src/app/api/ready/route.ts", "utf8");
const dockerIgnore = readFileSync(".dockerignore", "utf8");
const productionDockerfile = readFileSync("Dockerfile.prod", "utf8");
const databaseDockerfile = readFileSync("docker/db/Dockerfile.fly", "utf8");
const kongDockerfile = readFileSync("docker/kong/Dockerfile.fly", "utf8");
const ownerReconciliation = readFileSync("docker/bootstrap/supabase-admin-reconciliation.sql", "utf8");
const gitleaksConfig = readFileSync(".gitleaks.toml", "utf8");
const gitleaksIgnore = readFileSync(".gitleaksignore", "utf8");
const obscuraIntegration = readFileSync("tests/obscura-integration.mts", "utf8");
const remoteDeployBody = deploy.match(/rd\(\)\{([\s\S]*?)^\}/m)?.[1] ?? "";
const workflowBeforeDeployStep = deployWorkflow.slice(0, deployWorkflow.indexOf("- name: Deploy exact checked release"));
const deployJobStart = deployWorkflow.indexOf("\n  deploy:");
const deployJobConfiguration = deployWorkflow.slice(
  deployJobStart,
  deployWorkflow.indexOf("\n    steps:", deployJobStart),
);
const deployReleaseStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Deploy exact checked release"),
  deployWorkflow.indexOf("\n      - name: Verify tenant administrator gate"),
);
const tenantAdminGateStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Verify tenant administrator gate"),
  deployWorkflow.indexOf("\n      - name: Run isolated authenticated campaign acceptance"),
);
const campaignAcceptanceStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Run isolated authenticated campaign acceptance"),
  deployWorkflow.indexOf("\n      - name: Destroy the disposable recovery target"),
);
const releaseCandidateStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Materialize release candidate receipt"),
  deployWorkflow.indexOf("\n      - name: Record release evidence inventory"),
);
const finalAcceptanceStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Finalize accepted release receipt"),
  deployWorkflow.indexOf("\n      - name: Archive accepted release receipt"),
);
const releaseAnnouncementStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Announce accepted release"),
);
const publishImageStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Publish candidate images and materialize exact registry inputs"),
  deployWorkflow.indexOf("\n      - name: Deploy exact checked release"),
);
const promotionStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Promote only exact scanned candidate digests"),
  deployWorkflow.indexOf("\n      - name: Attest app build provenance"),
);
const releaseEvidenceInventoryStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Record release evidence inventory"),
  deployWorkflow.indexOf("\n      - name: Verify successful release evidence is complete"),
);
const releaseEvidenceVerificationStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Verify successful release evidence is complete"),
  deployWorkflow.indexOf("\n      - name: Archive non-secret release candidate and supply-chain evidence"),
);
const releaseEvidenceArchiveStep = deployWorkflow.slice(
  deployWorkflow.indexOf("\n      - name: Archive non-secret release candidate and supply-chain evidence"),
  deployWorkflow.indexOf("\n      - name: Finalize accepted release receipt"),
);
const releaseEvidenceArchiveId =
  releaseEvidenceArchiveStep.match(/^\s*id:\s*([a-z][a-z0-9_]*)\s*$/m)?.[1] ?? "";
const releaseEvidenceArtifactIdOutput = releaseEvidenceArchiveId
  ? `\${{ steps.${releaseEvidenceArchiveId}.outputs.artifact-id }}`
  : "";
const releaseEvidenceArtifactDigestOutput = releaseEvidenceArchiveId
  ? `\${{ steps.${releaseEvidenceArchiveId}.outputs.artifact-digest }}`
  : "";
const appDeployLine = deploy.split("\n").find((line) => /fly deploy --config fly\.app\.toml/.test(line)) ?? "";
const trackedFiles = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" }).stdout
  .split("\0")
  .filter(Boolean);
const canonicalProductionDeploySurfaces = new Set(["deploy-fly.sh", ".github/workflows/deploy-aria-mantu.yml"]);
const executableReleaseSurfaces = trackedFiles.filter(
  (path) => path === ".gitlab-ci.yml" || path.endsWith(".sh") || path.startsWith(".github/workflows/"),
);
const alternateProductionDeployPattern =
  /ARIA_DEPLOY_BUNDLE|fly\.io\/install\.sh|(?:^|\s)(?:bash\s+)?(?:\.\/)?deploy-fly\.sh\b|(?:^|\s)(?:fly|flyctl)\s+(?:deploy|machine\s+(?:run|destroy)|secrets\s+(?:set|import)|ips\s+allocate|volumes?\s+(?:destroy|update)|apps\s+destroy)\b/m;
const unsafeAlternateDeploySurfaces = executableReleaseSurfaces.filter((path) => {
  if (canonicalProductionDeploySurfaces.has(path) || !existsSync(path)) return false;
  return alternateProductionDeployPattern.test(readFileSync(path, "utf8"));
});
const dockerIgnorePatterns = new Set(
  dockerIgnore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

function indexOfOrInfinity(source: string, value: string) {
  const index = source.indexOf(value);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

function actionUsesAreImmutable(source: string) {
  const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  return uses.length > 0 && uses.every((value) => /@[0-9a-f]{40}$/.test(value));
}

function shellFunction(source: string, name: string) {
  const start = source.indexOf(`          ${name}() {`);
  if (start < 0) return "";
  const end = source.indexOf("\n          }", start);
  if (end < 0) return "";
  return source
    .slice(start, end + "\n          }".length)
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

function workflowStep(source: string, name: string): string {
  const marker = `\n      - name: ${name}\n`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\n      - name: ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

ok("production deploy is manual-only", /^\s{2}workflow_dispatch:\s*$/m.test(deployWorkflow) && !/^\s{2}push:\s*$/m.test(deployWorkflow));
ok("production deploy declares least-privilege permissions", /^permissions:\s*\n(?:\s{2}.+\n)+/m.test(deployWorkflow));
ok(
  "production deploy grants only the additional permissions required for signed attestations",
  /deploy:[\s\S]*permissions:[\s\S]*actions:\s*read[\s\S]*contents:\s*read[\s\S]*id-token:\s*write[\s\S]*attestations:\s*write[\s\S]*artifact-metadata:\s*write/.test(
    deployWorkflow,
  ),
);
ok("production deploy uses the protected Production environment", /^\s{4}environment:\s*Production\s*$/m.test(deployWorkflow));
ok(
  "production dispatch binds the workflow definition to the protected release branch and exact release SHA",
  /validate-dispatch:[\s\S]*name:\s*Validate protected release dispatch[\s\S]*ARIA_WORKFLOW_REF:\s*\$\{\{ github\.ref \}\}/.test(
    deployWorkflow,
  ) &&
    /ARIA_WORKFLOW_REF:\s*\$\{\{ github\.ref \}\}/.test(deployWorkflow) &&
    /ARIA_WORKFLOW_REF_TYPE:\s*\$\{\{ github\.ref_type \}\}/.test(deployWorkflow) &&
    /ARIA_WORKFLOW_REF_PROTECTED:\s*\$\{\{ github\.ref_protected \}\}/.test(deployWorkflow) &&
    /ARIA_WORKFLOW_SHA:\s*\$\{\{ github\.sha \}\}/.test(deployWorkflow) &&
    /"\$ARIA_WORKFLOW_SHA" != "\$ARIA_RELEASE_SHA"/.test(deployWorkflow) &&
    /deploy:[\s\S]*needs:\s*validate-dispatch[\s\S]*environment:\s*Production/.test(deployWorkflow),
);
ok(
  "production deploy job-level env does not use the unavailable runner context",
  !/\$\{\{\s*runner\./.test(deployJobConfiguration),
);
ok(
  "pending deployment receipt path is scoped to the deploy step",
  /ARIA_DEPLOYMENT_RECEIPT_PATH:\s*\$\{\{\s*runner\.temp\s*\}\}\/aria-deployment-receipt\.json/.test(deployReleaseStep) &&
    /ARIA_PREDEPLOY_RECEIPT_PATH:\s*\$\{\{\s*runner\.temp\s*\}\}\/aria-predeploy-receipt\.json/.test(
      deployReleaseStep,
    ),
);
ok(
  "the deployment script cannot self-certify application acceptance",
  /DEPLOYED_PENDING_ACCEPTANCE/.test(deploy) && !/RELEASE_ACCEPTED/.test(deploy) && !/acceptedAt:/.test(deploy),
);
ok(
  "administrator bootstrap requires absence proof and a separate exact release-bound protected approval",
  /ARIA_FIRST_ADMIN_EMAIL:\s*\$\{\{ secrets\.ARIA_FIRST_ADMIN_EMAIL \}\}/.test(tenantAdminGateStep) &&
    /ARIA_FIRST_ADMIN_PASSWORD:\s*\$\{\{ secrets\.ARIA_FIRST_ADMIN_PASSWORD \}\}/.test(tenantAdminGateStep) &&
    /ARIA_ADMIN_BOOTSTRAP_APPROVAL:\s*\$\{\{ vars\.ARIA_ADMIN_BOOTSTRAP_APPROVAL \}\}/.test(
      tenantAdminGateStep,
    ) &&
    /aria-admin-bootstrap-v1:\$\{ARIA_RELEASE_SHA\}:\$\{ARIA_RECOVERY_RECEIPT_SHA256\}/.test(
      tenantAdminGateStep,
    ) &&
    /admin_state/.test(tenantAdminGateStep) &&
    /absent/.test(tenantAdminGateStep) &&
    /scripts\/provision-first-admin\.sh/.test(tenantAdminGateStep) &&
    tenantAdminGateStep.indexOf("profiles?role=eq.admin") <
      tenantAdminGateStep.indexOf("scripts/provision-first-admin.sh") &&
    /ARIA_ALLOWED_EMAIL_DOMAIN/.test(tenantAdminGateStep),
);
ok(
  "an existing real administrator forbids stale bootstrap credentials and approval",
  /admin_state" = present/.test(tenantAdminGateStep) &&
    /\[ -z "\$ARIA_ADMIN_BOOTSTRAP_APPROVAL" \]/.test(tenantAdminGateStep) &&
    /\[ -z "\$ARIA_FIRST_ADMIN_EMAIL" \]/.test(tenantAdminGateStep) &&
    /\[ -z "\$ARIA_FIRST_ADMIN_PASSWORD" \]/.test(tenantAdminGateStep),
);
ok(
  "administrator inventory proves the profile belongs to the exact allowed-domain workspace",
  /select=id,role,workspace_id,workspaces!inner\(id,allowed_domain\)/.test(tenantAdminGateStep) &&
    /workspaces\.allowed_domain=eq\.%s/.test(tenantAdminGateStep) &&
    /"\$KONG_URL" "\$ARIA_ALLOWED_EMAIL_DOMAIN"/.test(tenantAdminGateStep) &&
    /workspace\.id !== row\.workspace_id/.test(tenantAdminGateStep) &&
    /workspace\.allowed_domain !== domain/.test(tenantAdminGateStep),
);
ok(
  "administrator inventory proves an active confirmed email-provider GoTrue identity",
  /auth\/v1\/admin\/users\/%s/.test(tenantAdminGateStep) &&
    /email_confirmed_at/.test(tenantAdminGateStep) &&
    /last_sign_in_at/.test(tenantAdminGateStep) &&
    /providers\.has\("email"\)/.test(tenantAdminGateStep) &&
    /user\.deleted_at/.test(tenantAdminGateStep) &&
    /banned_until/.test(tenantAdminGateStep) &&
    /aria_acceptance_marker/.test(tenantAdminGateStep),
);
ok(
  "tenant administrator verification removes credential and PII temporary files on every exit path",
  /cleanup_admin_gate\(\)/.test(tenantAdminGateStep) &&
    /trap cleanup_admin_gate EXIT HUP INT TERM/.test(tenantAdminGateStep) &&
    /rm -f -- "\$admin_response"/.test(tenantAdminGateStep) &&
    /rm -f -- "\$admin_config"/.test(tenantAdminGateStep) &&
    /rm -f -- "\$admin_candidate_ids"/.test(tenantAdminGateStep) &&
    /rm -f -- "\$admin_user_response"/.test(tenantAdminGateStep) &&
    /rm -f -- "\$admin_user_config"/.test(tenantAdminGateStep) &&
    /unset SUPABASE_SERVICE_ROLE_KEY ANON_KEY ARIA_ADMIN_BOOTSTRAP_APPROVAL ARIA_FIRST_ADMIN_EMAIL ARIA_FIRST_ADMIN_PASSWORD/.test(
      tenantAdminGateStep,
    ),
);
ok(
  "protected release runs isolated authenticated campaign persistence and no-send proof",
  /scripts\/acceptance-campaign-dry-run\.sh/.test(campaignAcceptanceStep) &&
    /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.FLY_SUPABASE_SERVICE_KEY \}\}/.test(campaignAcceptanceStep) &&
    /ANON_KEY:\s*\$\{\{ secrets\.FLY_SUPABASE_ANON_KEY \}\}/.test(campaignAcceptanceStep) &&
    /ARIA_ACCEPTANCE_RECEIPT_PATH:\s*\$\{\{ runner\.temp \}\}\/aria-application-acceptance\.json/.test(campaignAcceptanceStep),
);
ok(
  "release acceptance follows campaign proof and recovery-target cleanup",
  indexOfOrInfinity(deployWorkflow, "- name: Deploy exact checked release") <
    indexOfOrInfinity(deployWorkflow, "- name: Verify tenant administrator gate") &&
    indexOfOrInfinity(deployWorkflow, "- name: Verify tenant administrator gate") <
      indexOfOrInfinity(deployWorkflow, "- name: Run isolated authenticated campaign acceptance") &&
    indexOfOrInfinity(deployWorkflow, "- name: Run isolated authenticated campaign acceptance") <
      indexOfOrInfinity(deployWorkflow, "- name: Destroy the disposable recovery target") &&
    indexOfOrInfinity(deployWorkflow, "- name: Destroy the disposable recovery target") <
      indexOfOrInfinity(deployWorkflow, "- name: Materialize release candidate receipt"),
);
ok(
  "release candidate receipt requires every application and recovery proof without self-accepting",
  /if:\s*success\(\)/.test(releaseCandidateStep) &&
    /aria-deployment-receipt\.json/.test(releaseCandidateStep) &&
    /aria-tenant-admin-verification\.json/.test(releaseCandidateStep) &&
    /aria-application-acceptance\.json/.test(releaseCandidateStep) &&
    /aria-volume-recovery-cleanup\.json/.test(releaseCandidateStep) &&
    /pending-evidence-archive/.test(releaseCandidateStep) &&
    !/RELEASE_ACCEPTED/.test(releaseCandidateStep),
);
ok(
  "final acceptance validates administrator receipt schema, recovery binding, and bootstrap provenance",
  /tenantAdmin\.schemaVersion !== 1/.test(releaseCandidateStep) &&
    /tenantAdmin\.recoveryReceiptSha256 !== process\.env\.ARIA_RECOVERY_RECEIPT_SHA256/.test(
      releaseCandidateStep,
    ) &&
    /protected-admin-bootstrap/.test(releaseCandidateStep) &&
    /existing-admin-verified/.test(releaseCandidateStep) &&
    /adminBootstrapApprovalSha256/.test(releaseCandidateStep),
);
ok(
  "release receipts preserve the exact administrator identity proof instead of a generic boolean",
  /tenantAdmin\.identityProof !== "gotrue-active-email-provider-last-sign-in\+profile-workspace-domain"/.test(
    releaseCandidateStep,
  ) &&
    /identityProof:\s*tenantAdmin\.identityProof/.test(releaseCandidateStep),
);
ok(
  "accepted receipt is finalized and archived only after the complete evidence artifact succeeds",
  indexOfOrInfinity(deployWorkflow, "- name: Archive non-secret release candidate and supply-chain evidence") <
    indexOfOrInfinity(deployWorkflow, "- name: Finalize accepted release receipt") &&
    indexOfOrInfinity(deployWorkflow, "- name: Finalize accepted release receipt") <
      indexOfOrInfinity(deployWorkflow, "- name: Archive accepted release receipt") &&
    /status:\s*"accepted"/.test(finalAcceptanceStep) &&
    /evidenceInventorySha256/.test(finalAcceptanceStep),
);
ok(
  "the sole RELEASE_ACCEPTED announcement is terminal and revalidates the archived final receipt",
  (deployWorkflow.match(/RELEASE_ACCEPTED/g) ?? []).length === 1 &&
    indexOfOrInfinity(deployWorkflow, "- name: Archive accepted release receipt") <
      indexOfOrInfinity(deployWorkflow, "- name: Announce accepted release") &&
    /if:\s*success\(\)/.test(releaseAnnouncementStep) &&
    /aria-release-receipt\.json/.test(releaseAnnouncementStep) &&
    /receipt\.status !== "accepted"/.test(releaseAnnouncementStep) &&
    /RELEASE_ACCEPTED/.test(releaseAnnouncementStep),
);
ok(
  "always-run archive has a stable output id and an unambiguous candidate-evidence artifact name",
  releaseEvidenceArchiveId.length > 0 &&
    /name:\s*aria-release-candidate-evidence-\$\{\{ inputs\.release_sha \}\}-attempt-\$\{\{ github\.run_attempt \}\}/.test(
      releaseEvidenceArchiveStep,
    ) &&
    !/name:\s*aria-release-receipt-/.test(releaseEvidenceArchiveStep) &&
    /name:\s*aria-accepted-release-\$\{\{ inputs\.release_sha \}\}-attempt-\$\{\{ github\.run_attempt \}\}/.test(
      deployWorkflow,
    ),
);
ok(
  "accepted receipt binds the uploaded candidate-evidence artifact id and SHA-256 digest",
  releaseEvidenceArchiveId.length > 0 &&
    finalAcceptanceStep.includes(
      `ARIA_RELEASE_EVIDENCE_ARTIFACT_ID: ${releaseEvidenceArtifactIdOutput}`,
    ) &&
    finalAcceptanceStep.includes(
      `ARIA_RELEASE_EVIDENCE_ARTIFACT_SHA256: ${releaseEvidenceArtifactDigestOutput}`,
    ) &&
    /const evidenceArtifactId = process\.env\.ARIA_RELEASE_EVIDENCE_ARTIFACT_ID/.test(finalAcceptanceStep) &&
    /const evidenceArtifactSha256 = process\.env\.ARIA_RELEASE_EVIDENCE_ARTIFACT_SHA256/.test(
      finalAcceptanceStep,
    ) &&
    /\/\^\[1-9\]\[0-9\]\*\$\/\.test\(evidenceArtifactId\)/.test(finalAcceptanceStep) &&
    /\/\^\[0-9a-f\]\{64\}\$\/\.test\(evidenceArtifactSha256\)/.test(finalAcceptanceStep) &&
    /evidenceArtifact:\s*\{[\s\S]*?id:\s*evidenceArtifactId,[\s\S]*?sha256:\s*evidenceArtifactSha256[\s\S]*?\}/.test(
      finalAcceptanceStep,
    ),
);
ok(
  "terminal acceptance revalidates the immutable candidate-evidence artifact binding",
  /receipt\.evidenceArtifact\?\.id/.test(releaseAnnouncementStep) &&
    /receipt\.evidenceArtifact\?\.sha256/.test(releaseAnnouncementStep) &&
    /\/\^\[1-9\]\[0-9\]\*\$\//.test(releaseAnnouncementStep) &&
    /\/\^\[0-9a-f\]\{64\}\$\//.test(releaseAnnouncementStep),
);
ok("production deploy is serialized", /^concurrency:\s*$/m.test(deployWorkflow) && /cancel-in-progress:\s*false/.test(deployWorkflow));
ok("production deploy requires an exact release SHA", /release_sha:/.test(deployWorkflow) && /ARIA_RELEASE_SHA/.test(deployWorkflow));
ok("production deploy verifies CI for the release SHA", /require_workflow_success\s+ci\.yml/.test(deployWorkflow));
ok("production deploy verifies CodeQL for the release SHA", /require_workflow_success\s+codeql\.yml/.test(deployWorkflow));
ok(
  "production deploy blocks open high or critical code-scanning alerts on the exact protected release ref",
  /security-events:\s*read/.test(deployJobConfiguration) &&
    /code-scanning\/alerts/.test(deployWorkflow) &&
    /refs\/heads\/deploy\/fly-github-actions/.test(deployWorkflow) &&
    /for severity in critical high/.test(deployWorkflow) &&
    /open_code_alerts/.test(deployWorkflow) &&
    /process\.exit\(1\)/.test(deployWorkflow),
);
ok("production deploy does not restore an opaque secret archive", !/ARIA_DEPLOY_BUNDLE|base64\s+-d|tar\s+x/.test(deployWorkflow));
ok("production deploy does not execute a remote install script", !/curl[^\n]*\|\s*(?:ba)?sh|fly\.io\/install\.sh/.test(deployWorkflow));
if (unsafeAlternateDeploySurfaces.length > 0) {
  console.error("Unsafe alternate production deploy surfaces:", unsafeAlternateDeploySurfaces.join(", "));
}
ok(
  "only the reviewed GitHub workflow and hardened deploy script can mutate Fly production",
  unsafeAlternateDeploySurfaces.length === 0,
);
ok(
  "alternate-deploy detector rejects wrappers around the canonical mutation script",
  alternateProductionDeployPattern.test("script:\n  - bash deploy-fly.sh"),
);
ok(
  "production Docker context excludes internal agent state and retired deploy surfaces",
  [".rocket-fuel", "_relay", "_agent_state", ".gitlab-ci.yml", "deploy-fly-*.sh"].every((pattern) =>
    dockerIgnorePatterns.has(pattern),
  ),
);
ok("production deploy actions are pinned to immutable commits", actionUsesAreImmutable(deployWorkflow));
ok("production deploy pins the flyctl release", /version:\s*0\.4\.69/.test(deployWorkflow));
ok(
  "CI and release verify the pinned Trivy image signature with a pinned Cosign installer",
  [deployWorkflow, ciWorkflow].every(
    (workflow) =>
      /sigstore\/cosign-installer@[0-9a-f]{40}/.test(workflow) &&
      /cosign verify "\$TRIVY_IMAGE"[\s\S]*aquasecurity\/trivy/.test(workflow),
  ),
);
ok(
  "runtime deployment secrets are not exposed before the deploy step",
  !/secrets\.FLY_API_TOKEN|FLY_PG_PASSWORD|FLY_JWT_SECRET/.test(workflowBeforeDeployStep),
);
ok(
  "protected deploy receives independently managed database role credentials",
  [
    "FLY_PG_PASSWORD",
    "FLY_SUPABASE_ADMIN_CURRENT_PASSWORD",
    "FLY_SUPABASE_ADMIN_TARGET_PASSWORD",
    "FLY_AUTH_DB_PASSWORD",
    "FLY_REST_DB_PASSWORD",
  ].every((name) => deployReleaseStep.includes(`${name}: \${{ secrets.${name} }}`)),
);
ok(
  "protected deploy masks raw, encoded, and runtime DSN credential forms",
  /::add-mask::\$\{value\}/.test(deployReleaseStep) &&
    /::add-mask::\$\{encodeURIComponent\(value\)\}/.test(deployReleaseStep) &&
    /postgres:\/\/supabase_auth_admin:/.test(deployReleaseStep) &&
    /postgres:\/\/authenticator:/.test(deployReleaseStep),
);
ok(
  "registry promotion uses only its scoped token and never places it on the command line",
  /FLY_API_TOKEN:\s*\$\{\{ secrets\.FLY_REGISTRY_TOKEN \}\}/.test(publishImageStep) &&
    /flyctl auth docker/.test(publishImageStep) &&
    !/--access-token|FLY_PG_PASSWORD|FLY_JWT_SECRET/.test(publishImageStep),
);
ok(
  "protected release builds, scans, then publishes the exact app image before deployment",
  indexOfOrInfinity(deployWorkflow, "- name: Build exact release custom images") <
    indexOfOrInfinity(deployWorkflow, "- name: Publish candidate images and materialize exact registry inputs") &&
    indexOfOrInfinity(deployWorkflow, "- name: Publish candidate images and materialize exact registry inputs") <
      indexOfOrInfinity(deployWorkflow, "- name: Scan exact registry candidate images") &&
    indexOfOrInfinity(deployWorkflow, "- name: Scan exact registry candidate images") <
      indexOfOrInfinity(deployWorkflow, "- name: Promote only exact scanned candidate digests") &&
    indexOfOrInfinity(deployWorkflow, "- name: Promote only exact scanned candidate digests") <
      indexOfOrInfinity(deployWorkflow, "- name: Deploy exact checked release"),
);
ok(
  "exact release image uses production public build inputs",
  /Build exact release custom images[\s\S]*NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN:\s*\$\{\{ vars\.ARIA_ALLOWED_EMAIL_DOMAIN \}\}[\s\S]*node scripts\/validate-email-domain\.mjs "\$NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN"[\s\S]*--file Dockerfile\.prod[\s\S]*NEXT_PUBLIC_SUPABASE_URL=https:\/\/aria-mantu-kong\.fly\.dev[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY="\$NEXT_PUBLIC_SUPABASE_ANON_KEY"[\s\S]*NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN="\$NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN"[\s\S]*NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false/.test(
    deployWorkflow,
  ),
);
const acceptedDomain = spawnSync(process.execPath, ["scripts/validate-email-domain.mjs", "mantu.com"]);
const rejectedDomains = ["", "   ", "Mantu.com", "mantu", "mantu..com", "-mantu.com", "mantu.com ", "127.0.0.1"].map(
  (domain) => spawnSync(process.execPath, ["scripts/validate-email-domain.mjs", domain]),
);
ok(
  "production email-domain input accepts one canonical DNS domain and rejects unsafe or ambiguous forms",
  acceptedDomain.status === 0 && rejectedDomains.every((probe) => probe.status !== 0),
);
ok(
  "exact release image scan is digest-pinned and fail-closed",
  /TRIVY_IMAGE:\s*aquasec\/trivy:0\.72\.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f/.test(
    deployWorkflow,
  ) &&
    /Scan exact registry candidate images[\s\S]*"\$TRIVY_IMAGE"[\s\S]*--severity HIGH,CRITICAL[\s\S]*--exit-code 1[\s\S]*--scanners secret[\s\S]*--exit-code 1/.test(
      deployWorkflow,
    ),
);
ok(
  "CI and release scan image filesystem plus config and history for secrets",
  [ciWorkflow, deployWorkflow].every(
    (workflow) =>
      /--scanners secret\s*\\[\s\S]*?--image-config-scanners secret\s*\\[\s\S]*?--exit-code 1/.test(workflow),
  ),
);
ok(
  // Only the public-identifier rule may be disabled (it false-fires on Sillage field
  // names in the compiled bundle); the credential rule must never be disabled.
  "secret scans disable only the linkedin-client-id public-identifier rule",
  [ciWorkflow, deployWorkflow].every(
    (workflow) =>
      /disable-rules[\s\S]{0,40}linkedin-client-id/.test(workflow) &&
      !/disable-rules[\s\S]{0,200}linkedin-client-secret/.test(workflow) &&
      (workflow.match(/^\s*-\s+linkedin-client-id\s*$|"linkedin-client-id"/gm) ?? []).length === 1,
  ),
);
ok(
  "CI and release schema-validate every CycloneDX SBOM with an immutable official validator",
  [ciWorkflow, deployWorkflow].every(
    (workflow) =>
      /CYCLONEDX_CLI_IMAGE:\s*cyclonedx\/cyclonedx-cli:0\.32\.0@sha256:[0-9a-f]{64}/.test(workflow) &&
      /validate_cyclonedx\(\)[\s\S]*"\$CYCLONEDX_CLI_IMAGE" validate[\s\S]*--input-format json[\s\S]*--input-version v1_7[\s\S]*--fail-on-errors/.test(workflow) &&
      /specVersion:\s*"1\.7", version:\s*1[\s\S]*specVersion:\s*"1\.7", version:\s*0, unexpected:\s*true[\s\S]*if validate_cyclonedx[\s\S]*validator-invalid\.cdx\.json[\s\S]*exit 1/.test(
        workflow,
      ) &&
      /for component in app db bootstrap kong[\s\S]*validate_cyclonedx[^\n]*aria-\$component\.cdx\.json/.test(workflow),
  ),
);
ok(
  "Gitleaks has no path-wide allowlist and uses only exact reviewed history fingerprints",
  !/^\s*paths\s*=/m.test(gitleaksConfig) &&
    (() => {
      const fingerprints = gitleaksIgnore
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      return (
        fingerprints.length >= 11 &&
        new Set(fingerprints).size === fingerprints.length &&
        fingerprints.every((line) => /^[0-9a-f]{40}:[^:*?\[\]]+:[a-z0-9-]+:[1-9][0-9]*$/.test(line))
      );
    })(),
);
ok(
  "CI runs checksum-pinned Gitleaks against full history including the release commit",
  !/gitleaks\/gitleaks-action@/.test(ciWorkflow) &&
    /GITLEAKS_VERSION:\s*8\.30\.1/.test(ciWorkflow) &&
    /GITLEAKS_ARCHIVE_SHA256:\s*551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/.test(
      ciWorkflow,
    ) &&
    /sha256sum --check --strict/.test(ciWorkflow) &&
    /gitleaks git \. [^\n]*--log-opts='--all'/.test(ciWorkflow) &&
    !/gitleaks dir \./.test(ciWorkflow),
);
ok(
  "deployment publishes and exports immutable Fly registry digests for every custom image",
  /Promote only exact scanned candidate digests[\s\S]*release_tag="registry\.fly\.io\/\$app:sha-\$ARIA_RELEASE_SHA"[\s\S]*ARIA_\$\{component\^\^\}_IMAGE_REF/.test(
    deployWorkflow,
  ) &&
    ["app", "db", "bootstrap", "kong"].every((component) =>
      deployWorkflow.includes(`"${component}|aria-mantu-${component}`),
    ) &&
    !/<<<\s*"\$manifest"/.test(deployWorkflow),
);
const promotionDigestFunction = shellFunction(promotionStep, "digest_for");
const absentTagProbe = spawnSync(
  "bash",
  [
    "-c",
    `set -euo pipefail
RUNNER_TEMP="${process.env.TMPDIR ?? "/tmp"}"
export RUNNER_TEMP
docker() { printf 'manifest unknown\n' >&2; return 1; }
${promotionDigestFunction}
if digest="$(digest_for registry.fly.io/aria-mantu-app:sha-absent 2>/dev/null)"; then
  printf 'unexpected:%s' "$digest"
  exit 90
else
  lookup_status=$?
fi
[ "$lookup_status" -eq 44 ]
printf 'absent'`,
  ],
  { encoding: "utf8" },
);
ok(
  "registry promotion treats an absent release tag as absent instead of hashing empty input",
  promotionDigestFunction.length > 0 && absentTagProbe.status === 0 && absentTagProbe.stdout === "absent",
);
const indeterminateTagProbe = spawnSync(
  "bash",
  [
    "-c",
    `set -euo pipefail
RUNNER_TEMP="${process.env.TMPDIR ?? "/tmp"}"
export RUNNER_TEMP
docker() { printf 'dial tcp: registry timeout\n' >&2; return 1; }
${promotionDigestFunction}
if digest="$(digest_for registry.fly.io/aria-mantu-app:sha-unknown 2>/dev/null)"; then
  printf 'unexpected:%s' "$digest"
  exit 90
else
  lookup_status=$?
fi
[ "$lookup_status" -eq 45 ]
printf 'indeterminate'`,
  ],
  { encoding: "utf8" },
);
ok(
  "registry promotion refuses transient or authorization lookup failures instead of overwriting a SHA tag",
  indeterminateTagProbe.status === 0 &&
    indeterminateTagProbe.stdout === "indeterminate" &&
    /lookup_status=\$\?[\s\S]*"\$lookup_status" -ne 44[\s\S]*refusing promotion/.test(promotionStep),
);
ok(
  "release creates provenance and SBOM attestations for every custom image",
  (deployWorkflow.match(/uses:\s*actions\/attest@[0-9a-f]{40}/g) ?? []).length === 10 &&
    ["APP", "DB", "BOOTSTRAP", "KONG", "GRAPHIFY"].every(
      (component) =>
        deployWorkflow.includes(`ARIA_${component}_IMAGE_DIGEST`) &&
        deployWorkflow.includes(`aria-${component.toLowerCase()}.cdx.json`),
    ) &&
    /aria-\$name\.sigstore\.json/.test(deployWorkflow),
);
ok(
  "release manifest binds images, Dockerfiles, scanner evidence, and attestation IDs",
  /aria-release-manifest\.json/.test(deployWorkflow) &&
    /dockerfileSha256/.test(deployWorkflow) &&
    /candidateImage:[\s\S]*promotedImage:[\s\S]*attestations:[\s\S]*evidence:/.test(deployWorkflow) &&
    /scanner:\s*process\.env\.TRIVY_IMAGE/.test(deployWorkflow) &&
    /sbomValidator:\s*process\.env\.CYCLONEDX_CLI_IMAGE/.test(deployWorkflow),
);

ok("CI uses the repository Node 22 contract", /node-version:\s*["']?22["']?/.test(ciWorkflow));
const requiredObscuraProbe = spawnSync(
  process.execPath,
  ["--import", "tsx", "tests/obscura-integration.mts"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      ARIA_REQUIRE_OBSCURA_TEST: "true",
      OBSCURA_BIN_PATH: "",
      OBSCURA_URL: "http://127.0.0.1:1",
    },
    timeout: 10_000,
  },
);
const obscuraReadinessStep = workflowStep(ciWorkflow, "Wait for Obscura sidecar");
const obscuraIntegrationStep = workflowStep(ciWorkflow, "Obscura integration test");
ok(
  "required Obscura integration mode fails when the sidecar is unreachable",
  requiredObscuraProbe.status === 1 &&
    requiredObscuraProbe.error === undefined &&
    requiredObscuraProbe.signal === null &&
    /REQUIRED: no Obscura sidecar reachable/.test(
      `${requiredObscuraProbe.stdout}${requiredObscuraProbe.stderr}`,
    ) &&
    /ARIA_REQUIRE_OBSCURA_TEST/.test(obscuraIntegration),
);
ok(
  "CI waits for Obscura readiness and makes the integration test mandatory",
  /\/json\/version/.test(obscuraReadinessStep) &&
    /for attempt in \$\(seq 1 30\)/.test(obscuraReadinessStep) &&
    /ARIA_REQUIRE_OBSCURA_TEST:\s*["']true["']/.test(obscuraIntegrationStep),
);
ok("CI has an independent dependency-audit job", /^\s{2}dependency-audit:\s*$/m.test(ciWorkflow));
ok("CI has an independent secret-scan job", /^\s{2}secret-scan:\s*$/m.test(ciWorkflow));
ok("CI has an independent production-image supply-chain job", /^\s{2}supply-chain:\s*$/m.test(ciWorkflow));
ok(
  "supply-chain job builds every production custom Dockerfile",
  ["Dockerfile.prod", "docker/db/Dockerfile.fly", "docker/bootstrap/Dockerfile.fly", "docker/kong/Dockerfile.fly", "workers/graphify-lessons/Dockerfile"].every(
    (dockerfile) => ciWorkflow.includes(`--file ${dockerfile}`),
  ),
);
ok(
  "supply-chain scanner image is versioned and digest pinned",
  /TRIVY_IMAGE:\s*aquasec\/trivy:0\.72\.0@sha256:cffe3f5161a47a6823fbd23d985795b3ed72a4c806da4c4df16266c02accdd6f/.test(
    ciWorkflow,
  ),
);
ok(
  "supply-chain job generates a CycloneDX SBOM from the built image",
  /for component in app db bootstrap kong[\s\S]*--input "\/image\/aria-\$component-image\.tar"[\s\S]*--format cyclonedx[\s\S]*--output "\/artifacts\/aria-\$component\.cdx\.json"/m.test(
    ciWorkflow,
  ),
);
ok(
  // ignore-unfixed=true: block every HIGH/CRITICAL with an available remediation; do
  // not permanently redline on Debian CVEs that have no fix (e.g. CVE-2023-45853).
  // The gate re-arms automatically the moment upstream publishes a fixed version.
  "supply-chain scan is fail-closed for all fixable high and critical vulnerabilities",
  /--scanners vuln/.test(ciWorkflow) &&
    /--severity HIGH,CRITICAL/.test(ciWorkflow) &&
    /--ignore-unfixed=true/.test(ciWorkflow) &&
    !/--ignore-unfixed=false/.test(ciWorkflow) &&
    /--exit-code 1/.test(ciWorkflow) &&
    !/supply-chain:[\s\S]*continue-on-error:\s*true/m.test(ciWorkflow),
);
ok(
  // The standalone Next.js runtime needs only `node`; npm's bundled node_modules
  // (sigstore, picomatch) otherwise reintroduce fixable HIGH CVEs into the image.
  "production runner image strips npm, corepack, and yarn",
  /AS runner[\s\S]*RUN rm -rf \/usr\/local\/lib\/node_modules \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/m.test(
    productionDockerfile,
  ),
);
ok(
  "supply-chain scan only reads a local immutable image archive",
  /docker image save[\s\S]*--output "\$RUNNER_TEMP\/aria-scan-input\/aria-\$component-image\.tar"[\s\S]*"\$image"/m.test(
    ciWorkflow,
  ) &&
    (ciWorkflow.match(/--input "\/image\/aria-\$component-image\.tar"/g) ?? []).length >= 3 &&
    (ciWorkflow.match(/--volume "\$RUNNER_TEMP\/aria-scan-input:\/image:ro"/g) ?? []).length >= 2 &&
    !/\/var\/run\/docker\.sock/.test(ciWorkflow),
);
ok(
  "CI archives only named non-secret supply-chain reports with an immutable action",
  /actions\/upload-artifact@[0-9a-f]{40}[\s\S]*aria-\*\.cdx\.json[\s\S]*aria-\*\.cdx\.json\.sha256[\s\S]*aria-\*-vulnerabilities\.json[\s\S]*aria-\*-secrets\.json/m.test(
    ciWorkflow,
  ),
);
ok("CI has an aggregate release gate", /^\s{2}release-gate:\s*$/m.test(ciWorkflow) && /if:\s*always\(\)/.test(ciWorkflow));
ok(
  "aggregate release gate requires the supply-chain result",
  /needs:\s*\[[^\]]*supply-chain[^\]]*\]/.test(ciWorkflow) &&
    /SUPPLY_CHAIN_RESULT:\s*\$\{\{ needs\.supply-chain\.result \}\}/.test(ciWorkflow) &&
    /\$SUPPLY_CHAIN_RESULT"?\s*!=\s*success/.test(ciWorkflow),
);
ok("CI never pipes a remote installer into a shell", !/curl[^\n]*\|\s*(?:ba)?sh/.test(ciWorkflow));
ok("CI actions are pinned to immutable commits", actionUsesAreImmutable(ciWorkflow));
ok("CodeQL actions are pinned to immutable commits", actionUsesAreImmutable(codeqlWorkflow));

ok("deploy script does not execute secret files as shell code", !/\bsource\s+production-readiness\/\.fly-secrets\.env/.test(deploy));
ok(
  "production mutator accepts credentials only from the protected workflow environment",
  /GITHUB_ACTIONS/.test(deploy) &&
    /ARIA_PROTECTED_RELEASE_CONTEXT/.test(deploy) &&
    /GITHUB_WORKFLOW_REF/.test(deploy) &&
    !/FLY_TOKEN_FILE|FLY_SECRETS_FILE|\.fly-token\.env|\.fly-secrets\.env/.test(deploy) &&
    !/gv\(\)|\.env\.local/.test(deploy),
);
ok(
  "protected workflow binds the mutator to this run and exact release SHA",
  /ARIA_PROTECTED_RELEASE_CONTEXT:\s*aria-protected-release-v1:\$\{\{ github\.run_id \}\}:\$\{\{ github\.run_attempt \}\}:\$\{\{ inputs\.release_sha \}\}/.test(
    deployReleaseStep,
  ),
);
ok("deploy stages secret values over stdin, never flyctl argv", /secrets import/.test(deploy) && !/fly secrets set/.test(deploy));
ok(
  "failure cleanup never turns an ambiguous staged write into a staged deletion",
  /automatic rollback is forbidden/.test(deploy) &&
    !/fly secrets unset/.test(
      deploy.slice(
        deploy.indexOf("cleanup_unactivated_staged_secrets_best_effort(){"),
        deploy.indexOf("# Deploys are intentionally single-shot"),
      ),
    ),
);
ok(
  "deploy tracks staged, activating, and activated secret lifecycle states",
  /set_component_secret_state "\$app" staging/.test(deploy) &&
    /set_component_secret_state "\$app" staged/.test(deploy) &&
    /set_component_secret_state "\$app" activating/.test(deploy) &&
    /set_component_secret_state "\$app" activated/.test(deploy),
);
ok(
  "temporary DB and bootstrap credentials are retired and inventory-verified",
  /fly secrets unset --app aria-mantu-db/.test(deploy) &&
    /fly secrets unset --stage --app aria-mantu-bootstrap/.test(deploy) &&
    /secret_names_absent aria-mantu-db/.test(deploy) &&
    /secret_names_absent aria-mantu-bootstrap/.test(deploy),
);
ok("deploy script standardizes Fly commands on flyctl", /fly\(\)\{ command flyctl "\$@"; \}/.test(deploy));
ok(
  "deploy script supports independent owner and migrator password rotation",
  !/FLY_DB_ADMIN_PASSWORD|POSTGRES_CURRENT_PASSWORD/.test(deploy) &&
    /FLY_SUPABASE_ADMIN_CURRENT_PASSWORD/.test(deploy) &&
    /FLY_SUPABASE_ADMIN_TARGET_PASSWORD/.test(deploy) &&
    /POSTGRES_TARGET_PASSWORD/.test(deploy) &&
    /SUPABASE_ADMIN_CURRENT_PASSWORD/.test(bootstrap) &&
    /SUPABASE_ADMIN_TARGET_PASSWORD/.test(bootstrap),
);
ok(
  "every database connection password is URI encoded independently",
  /uri_encode/.test(deploy) &&
    /AUTH_DB_PASSWORD_URI/.test(deploy) &&
    /REST_DB_PASSWORD_URI/.test(deploy) &&
    !/SUPABASE_ADMIN_CURRENT_PASSWORD_URI|SUPABASE_ADMIN_TARGET_PASSWORD_URI|DB_ADMIN_PASSWORD_URI/.test(deploy),
);
ok(
  "runtime services never reuse owner or migrator credentials",
  /supabase_auth_admin:\$AUTH_DB_PASSWORD_URI/.test(deploy) &&
    /authenticator:\$REST_DB_PASSWORD_URI/.test(deploy) &&
    !/PG_PASSWORD_URI|supabase_auth_admin:\$FLY_PG_PASSWORD|authenticator:\$FLY_PG_PASSWORD/.test(deploy),
);
ok("Supabase JWT keys are verified against the staged signing secret", /timingSafeEqual/.test(deploy) && /service_role/.test(deploy));
ok("database reconciliation rotates the Postgres migrator role", /alter role %I login password %L[\s\S]*'postgres'/i.test(ownerReconciliation));
ok("deploy script requires an exact 40-character release SHA", /ARIA_RELEASE_SHA/.test(deploy) && /\{40\}/.test(deploy));
ok(
  "deploy script requires every promoted custom-image digest",
  ["APP", "DB", "BOOTSTRAP", "KONG"].every((component) => deploy.includes(`ARIA_\${component}_IMAGE_REF`)) &&
    /registry\\\.fly\\\.io\/\$\{app_name\}:sha-/.test(deploy),
);
ok("deploy script rejects tracked and untracked working-tree drift", /git status --porcelain --untracked-files=all/.test(deploy));
ok("migration image never uses the mutable latest tag", !/aria-mantu-bootstrap:latest|--image-label\s+latest/.test(deploy));
ok(
  "migration runner uses only the approved bootstrap manifest digest",
  /fly machine run "\$ARIA_BOOTSTRAP_IMAGE_REF"/.test(deploy) &&
    !/fly deploy --config fly\.bootstrap\.toml|--build-only|resolve_registry_digest/.test(deploy),
);
ok("deploy derives a complete migration-ledger manifest", /EXPECTED_MIGRATION_COUNT/.test(deploy) && /EXPECTED_LEDGER_SHA/.test(deploy) && /entry\.filename}:\${entry\.sha256}\\n/.test(deploy));
ok(
  "owner credential reconciliation runs before Auth deployment",
  indexOfOrInfinity(deploy, "ARIA_BOOTSTRAP_PHASE=owner") < indexOfOrInfinity(deploy, "deploy GoTrue"),
);
ok(
  "runtime target credentials activate before application migrations",
  indexOfOrInfinity(deploy, "fly deploy --config fly.auth.toml") < indexOfOrInfinity(deploy, "ARIA_BOOTSTRAP_PHASE=migrations") &&
    indexOfOrInfinity(deploy, "fly deploy --config fly.rest.toml") < indexOfOrInfinity(deploy, "ARIA_BOOTSTRAP_PHASE=migrations"),
);
ok("post-mutation acceptance requires app readiness", /require_http_200[^\n]*app \/api\/ready[^\n]*\/api\/ready/.test(deploy));
ok("Fly app deployment has a readiness health check", /path\s*=\s*"\/api\/ready"/.test(appFlyConfig));
ok("readiness dependency calls have bounded timeouts", (readinessRoute.match(/AbortSignal\.timeout\(3_000\)/g) ?? []).length >= 4);
ok("app readiness checks the complete ordered migration ledger", /\.order\("filename", \{ ascending: true \}\)/.test(readinessRoute) && /ledgerSha256/.test(readinessRoute) && /expectedMigrationCount/.test(readinessRoute));
ok("database deployment cannot accept a stopped machine as healthy", /internal_port\s*=\s*5432[\s\S]*services\.tcp_checks/.test(dbFlyConfig));
ok("Auth deployment has a service health check", /internal_port\s*=\s*9999[\s\S]*services\.tcp_checks/.test(authFlyConfig));
ok("REST deployment has a service health check", /internal_port\s*=\s*3000[\s\S]*services\.tcp_checks/.test(restFlyConfig));
ok("production Node base image is digest pinned", /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}/m.test(productionDockerfile));
ok("production database base image is digest pinned", /^FROM supabase\/postgres:[^\s]+@sha256:[0-9a-f]{64}/m.test(databaseDockerfile));
ok("production Kong base image is digest pinned", /^FROM kong\/kong:[^\s]+@sha256:[0-9a-f]{64}/m.test(kongDockerfile));
ok("production Auth image is digest pinned", /image\s*=\s*"supabase\/gotrue:[^"]+@sha256:[0-9a-f]{64}"/.test(authFlyConfig));
ok("production REST image is digest pinned", /image\s*=\s*"postgrest\/postgrest:[^"]+@sha256:[0-9a-f]{64}"/.test(restFlyConfig));
ok(
  "release materializes and inventories exact upstream Auth and REST images without claiming local build provenance",
    /upstream-images\.tsv/.test(deployWorkflow) &&
    /\["auth", "fly\.auth\.toml", "supabase\/gotrue"\]/.test(publishImageStep) &&
    /\["rest", "fly\.rest\.toml", "postgrest\/postgrest"\]/.test(publishImageStep) &&
    /aria-\$component-image\.tar/.test(publishImageStep) &&
    !/- name:\s*Attest (?:Auth|REST) build provenance/i.test(deployWorkflow),
);
ok(
  "Auth and REST exact images receive the same SBOM vulnerability and secret gates as custom images",
  /for component in app db bootstrap kong graphify auth rest/.test(deployWorkflow) &&
    /\["app", "db", "bootstrap", "kong", "graphify", "auth", "rest"\]/.test(releaseEvidenceInventoryStep) &&
    /for component in app db bootstrap kong graphify auth rest/.test(releaseEvidenceVerificationStep),
);
ok("remote deploys are not locally killed and blindly retried", remoteDeployBody.length > 0 && !/\bfast\b|\bwhile\b/.test(remoteDeployBody));
ok(
  "app deploy consumes the scanned image without rebuilding",
  /--image\s+"\$ARIA_APP_IMAGE_REF"/.test(appDeployLine) &&
    !/--remote-only|--build-arg|--image-label/.test(appDeployLine),
);
ok(
  "acceptance compares the running app digest with the promoted digest",
  /APP_EXPECTED_DIGEST=.*ARIA_APP_IMAGE_REF/.test(deploy) &&
    /\[ "\$APP_IMAGE_DIGEST" = "\$APP_EXPECTED_DIGEST" \]/.test(deploy),
);
ok(
  "acceptance compares every running custom service with its promoted digest",
  /DB_EXPECTED_DIGEST=.*ARIA_DB_IMAGE_REF/.test(deploy) &&
    /KONG_EXPECTED_DIGEST=.*ARIA_KONG_IMAGE_REF/.test(deploy) &&
    /\[ "\$DB_IMAGE_DIGEST" = "\$DB_EXPECTED_DIGEST" \]/.test(deploy) &&
    /\[ "\$KONG_IMAGE_DIGEST" = "\$KONG_EXPECTED_DIGEST" \]/.test(deploy),
);
ok(
  "acceptance compares running Auth and REST with their config-pinned upstream digests",
  /AUTH_EXPECTED_DIGEST/.test(deploy) &&
    /REST_EXPECTED_DIGEST/.test(deploy) &&
    /\[ "\$AUTH_IMAGE_DIGEST" = "\$AUTH_EXPECTED_DIGEST" \]/.test(deploy) &&
    /\[ "\$REST_IMAGE_DIGEST" = "\$REST_EXPECTED_DIGEST" \]/.test(deploy),
);
ok(
  "owner and application reconciliation each execute exactly once",
  (deploy.match(/^fly machine run "\$ARIA_BOOTSTRAP_IMAGE_REF"/gm) ?? []).length === 2 &&
    (deploy.match(/ARIA_BOOTSTRAP_PHASE=owner/g) ?? []).length === 1 &&
    (deploy.match(/ARIA_BOOTSTRAP_PHASE=migrations/g) ?? []).length === 1 &&
    !/\brs[^\n]*fly machine run/.test(deploy),
);
ok("release receipt records deployed image digests", /DB_IMAGE_DIGEST[\s\S]*AUTH_IMAGE_DIGEST[\s\S]*REST_IMAGE_DIGEST[\s\S]*KONG_IMAGE_DIGEST[\s\S]*APP_IMAGE_DIGEST/.test(deploy));
ok("release receipt records previous image digests for rollback", /previousImages:[\s\S]*PREVIOUS_DB_IMAGE_DIGEST[\s\S]*PREVIOUS_APP_IMAGE_DIGEST/.test(deploy));
ok(
  "workflow archives the release receipt and exact-image supply-chain evidence",
  /actions\/upload-artifact@[0-9a-f]{40}/.test(deployWorkflow) &&
    /aria-deployment-receipt\.json/.test(deployWorkflow) &&
    /aria-tenant-admin-verification\.json/.test(deployWorkflow) &&
    /aria-application-acceptance\.json/.test(deployWorkflow) &&
    /aria-release-candidate-receipt\.json/.test(deployWorkflow) &&
    /aria-release-receipt\.json/.test(deployWorkflow) &&
    /aria-\*\.cdx\.json/.test(deployWorkflow) &&
    /aria-\*-vulnerabilities\.json/.test(deployWorkflow) &&
    /aria-\*-secrets\.json/.test(deployWorkflow) &&
    /aria-\*-artifacts\.sha256/.test(deployWorkflow),
);
ok(
  "release evidence inventory runs after failures and records partial artifacts",
  /if:\s*always\(\)/.test(releaseEvidenceInventoryStep) &&
    /aria-release-evidence-inventory\.json/.test(releaseEvidenceInventoryStep) &&
    /exists/.test(releaseEvidenceInventoryStep),
);
ok(
  "successful releases require every expected receipt and supply-chain artifact",
  /if:\s*success\(\)/.test(releaseEvidenceVerificationStep) &&
    /aria-deployment-receipt\.json/.test(releaseEvidenceVerificationStep) &&
    /aria-tenant-admin-verification\.json/.test(releaseEvidenceVerificationStep) &&
    /aria-application-acceptance\.json/.test(releaseEvidenceVerificationStep) &&
    /aria-release-candidate-receipt\.json/.test(releaseEvidenceVerificationStep) &&
    /for component in app db bootstrap kong graphify auth rest/.test(releaseEvidenceVerificationStep) &&
    /\.cdx\.json -vulnerabilities\.json -secrets\.json -artifacts\.sha256/.test(releaseEvidenceVerificationStep) &&
    /for component in app db bootstrap kong graphify; do[\s\S]*-provenance\.sigstore\.json -sbom\.sigstore\.json/.test(
      releaseEvidenceVerificationStep,
    ) &&
    /aria-release-images\.json/.test(releaseEvidenceVerificationStep) &&
    /aria-release-manifest\.json/.test(releaseEvidenceVerificationStep) &&
    /attestation-ids\.tsv/.test(releaseEvidenceVerificationStep),
);
ok(
  "release evidence upload runs after scan, publish, or deploy failure",
  /if:\s*always\(\)/.test(releaseEvidenceArchiveStep) &&
    /aria-release-evidence-inventory\.json/.test(releaseEvidenceArchiveStep) &&
    /if-no-files-found:\s*error/.test(releaseEvidenceArchiveStep),
);
for (const ignoredPath of [".env*", "backups", ".superpowers", "supabase/.branches", "supabase/.temp", "next-env.d.ts", "*.tsbuildinfo"]) {
  ok(`Docker build context excludes ${ignoredPath}`, dockerIgnore.split("\n").includes(ignoredPath));
}

ok(
  "bootstrap image contains the consolidated direct-owner reconciliation",
  /COPY\s+docker\/bootstrap\/supabase-admin-reconciliation\.sql\s+\/opt\/aria\/supabase-admin-reconciliation\.sql/.test(
    bootstrapImage,
  ),
);
ok(
  "owner transaction reconciles roles, JWT policy, and Auth ownership atomically",
  ownerReconciliation.indexOf("begin;") >= 0 &&
    ownerReconciliation.indexOf("alter role") > ownerReconciliation.indexOf("begin;") &&
    ownerReconciliation.indexOf("alter schema auth owner to supabase_auth_admin") > ownerReconciliation.indexOf("begin;") &&
    ownerReconciliation.indexOf("app.settings.jwt_secret") > ownerReconciliation.indexOf("begin;") &&
    ownerReconciliation.lastIndexOf("commit;") > ownerReconciliation.indexOf("app.settings.jwt_secret"),
);
ok(
  "bootstrap fails closed when consolidated owner reconciliation fails",
  /OWNER_RECONCILIATION_FILE[\s\S]*psql[\s\S]*-f "\$OWNER_PLAN"/.test(bootstrap) &&
    !/psql[^\n]*\|\|\s*true/.test(bootstrap),
);
ok(
  "legacy secret-bearing reconciliation files are absent from production images",
  !/01-roles\.sql|02-jwt\.sql|03-auth-owner\.sql/.test(bootstrapImage) &&
    !/01-roles\.sql|02-jwt\.sql|03-auth-owner\.sql/.test(databaseDockerfile),
);
ok(
  "application migrations never receive owner or JWT reconciliation SQL",
  !/JWT_FILE|roles\.sql|auth-owner\.sql/.test(bootstrap),
);
ok("bootstrap serializes migrations with a database advisory lock", /pg_advisory_xact_lock/.test(bootstrap));
ok("bootstrap records migration filename and SHA-256", /schema_migrations/.test(bootstrap) && /sha256/.test(bootstrap));
ok("bootstrap legacy-schema guards raise transactional SQL errors", /raise exception 'existing ARIA schema has no migration ledger/.test(bootstrap) && /raise exception 'existing ARIA schema has an empty migration ledger/.test(bootstrap) && !/\\quit\s+[0-9]+/.test(bootstrap));

console.log(`RESULT infra-release-contract: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
