import { existsSync, readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
}

const scriptPath = new URL("../scripts/run-sourcing-learning.mjs", import.meta.url);
const reviewScriptPath = new URL("../scripts/review-sourcing-lesson.mjs", import.meta.url);
const configureScriptPath = new URL("../scripts/configure-sourcing-learning.mjs", import.meta.url);
const containerTestPath = new URL("./graphify-learning-container.sh", import.meta.url);
const dockerfilePath = new URL("../workers/graphify-lessons/Dockerfile", import.meta.url);
const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
const reviewScript = existsSync(reviewScriptPath) ? readFileSync(reviewScriptPath, "utf8") : "";
const configureScript = existsSync(configureScriptPath) ? readFileSync(configureScriptPath, "utf8") : "";
const containerTest = existsSync(containerTestPath)
  ? readFileSync(containerTestPath, "utf8")
  : "";
const dockerfile = existsSync(dockerfilePath) ? readFileSync(dockerfilePath, "utf8") : "";

ok("Graphify learning operator exists", script.length > 0);
ok("operator exports only through the service RPC", /export_graphify_sourcing_lessons/.test(script));
ok("operator requires an image digest", /GRAPHIFY_LESSONS_IMAGE/.test(script) && /@sha256:/.test(script));
ok("worker execution has no network", /"--network",\s*"none"/.test(script));
ok("worker execution is read-only and capability-free", /"--read-only"/.test(script) && /"--cap-drop",\s*"ALL"/.test(script));
ok("operator validates the pinned Graphify commit", script.includes("94d3099540550d58dd121ec3e67cf93e80364079"));
ok("operator independently hashes the graph before persistence", /validateGraph\(graphText, manifest\)/.test(script) && /createHash\("sha256"\)/.test(script));
ok("operator durably completes the database export before attachment", /complete_graphify_sourcing_export/.test(script) && script.indexOf("complete_graphify_sourcing_export") < script.indexOf("attach_graphify_sourcing_lesson"));
ok("operator attaches only through the completed export authority", /p_export_id:\s*exportId/.test(script) && /p_expected_version:\s*attachment\.expectedVersion/.test(script));
ok("operator cannot promote lessons", !/review_sourcing_lesson/.test(script));
ok("operator removes temporary aggregate input", /await rm\(work, \{ recursive: true, force: true \}\)/.test(script));
ok("container acceptance also denies network", /--network none/.test(containerTest));
ok("both worker stages pin the Python base by immutable digest",
  (dockerfile.match(/^FROM python:3\.12-slim@sha256:[a-f0-9]{64}/gm) ?? []).length === 2);
ok("container acceptance trusts the immutable base instead of pulling a mutable tag",
  !/docker build[^\n]*--pull/.test(containerTest));
ok("human review operator exists", reviewScript.length > 0);
ok("human review requires exact optimistic version confirmation", /review:\$\{lessonId\}:\$\{decision\}:\$\{expectedVersion\}/.test(reviewScript));
ok("human review is a separate RPC", /review_sourcing_lesson/.test(reviewScript) && !/attach_graphify_sourcing_lesson/.test(reviewScript));
ok("configuration operator binds learning to an immutable worker digest", /configure_sourcing_learning/.test(configureScript) && /p_required_graphify_image_digest:\s*image/.test(configureScript));
ok("configuration operator requires exact optimistic confirmation", /configure:\$\{workspaceId\}:\$\{enabledText\}:\$\{expectedVersion\}:\$\{image\}/.test(configureScript));

console.log(`RESULT sourcing-learning-operations: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
