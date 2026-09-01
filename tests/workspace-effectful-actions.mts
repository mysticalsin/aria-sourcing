import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.log("FAIL:", name);
  }
}

const source = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
const sourcingActionsSource = readFileSync(
  new URL("../src/lib/store/sourcing-actions.ts", import.meta.url),
  "utf8",
);
const bookingReportActionsSource = readFileSync(
  new URL("../src/lib/store/booking-report-actions.ts", import.meta.url),
  "utf8",
);

function actionBody(name: string, nextName: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start + 1);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

function guardedBefore(body: string, effectPattern: RegExp): boolean {
  const guard = body.search(/if \(!workspaceEffectAllowed\(\)[^\n{]*\)/);
  const effect = body.search(effectPattern);
  return guard >= 0 && effect > guard;
}

ok(
  "all store fetch dispatches use the reusable availability-aware fetch boundary",
  (source.match(/\bfetch\(/g) ?? []).length === 1 &&
    /const workspaceFetch = useCallback[\s\S]{0,500}\bfetch\(/.test(source),
);

ok(
  "source and provider paths preflight before live dispatch",
  guardedBefore(sourcingActionsSource, /workspaceFetch\("\/api\/source"/) &&
    guardedBefore(actionBody("runSourcingAgent", "generateOutreachFor"), /requestReviewedSourcing\(/) &&
    guardedBefore(actionBody("generateOutreachLive", "draftFollowUpFor"), /runWorkspaceEffect\(/),
);

ok(
  "live outbound send preflights at action start and dispatch time",
  guardedBefore(actionBody("sendApprovedOutreach", "rejectOutreach"), /workspaceFetch\("\/api\/outreach\/send"/),
);
ok(
  "send and LinkedIn confirm require channel-connect plus approval",
  /liveSendBlocker\(/.test(actionBody("sendApprovedOutreach", "rejectOutreach")) &&
    /liveSendBlocker\(/.test(actionBody("confirmManualSend", "sendApprovedOutreach")),
);

const addSeat = actionBody("addSeat", "deployAgents");
ok(
  "fleet seat creation preflights before preparing and immediately before server creation",
  guardedBefore(addSeat, /runWorkspaceEffect\([\s\S]*createFleetSeatOnServer/) &&
    /runWorkspaceEffect\([\s\S]*createFleetSeatOnServer/.test(addSeat),
);

const suppression = actionBody("persistSuppressionToServer", "syncSuppressionToServer");
const applyReplyAction = actionBody("applyReplyAction", "draftReplyResponse");
ok(
  "suppression persistence and negative-reply enforcement preflight before server mutation",
  /workspaceFetch\("\/api\/compliance\/suppress"/.test(suppression) &&
    guardedBefore(applyReplyAction, /persistSuppressionToServer\(/) &&
    /persistManualSuppression\([\s\S]*workspaceFetch/.test(source),
);

ok(
  "API-key storage preflights before secret leaves the action and at fetch dispatch",
  guardedBefore(actionBody("saveApiKey", "testApiKey"), /workspaceFetch\("\/api\/keys"/),
);

ok(
  "calendar and integration probes preflight before external work",
  /if \(!bookingMutationAllowed\(\) \|\| !workspaceEffectAllowed\(\)\)[\s\S]*?workspaceFetch\("\/api\/calendar\/event"/.test(bookingReportActionsSource) &&
    guardedBefore(actionBody("testIntegration", "addSeat"), /workspaceFetch\("\/api\/source"/),
);

ok(
  "remaining helper-backed mutations use the same dispatch-time preflight",
  /recordOutreachApproval\([\s\S]*workspaceFetch/.test(source) &&
    /revokeOutreachApproval\([\s\S]*workspaceFetch/.test(source) &&
    /runWorkspaceEffect\([\s\S]*patchFleetSeatOnServer/.test(source),
);

const approveOutreach = actionBody("approveOutreach", "confirmManualSend");
const compensationStart = approveOutreach.indexOf("const revokeStaleApproval");
const revalidationStart = approveOutreach.indexOf("s = current()", compensationStart);
const staleApprovalCompensation = compensationStart >= 0 && revalidationStart > compensationStart
  ? approveOutreach.slice(compensationStart, revalidationStart)
  : "";
ok(
  "a recorded approval can still be compensated after workspace availability drops",
  /recordOutreachApproval\(\{ messageId, \.\.\.approvalSnapshot \}, workspaceFetch\)/.test(approveOutreach) &&
    /if \(!persisted\.ok\) return approvalBlocked/.test(approveOutreach) &&
    /revokeOutreachApproval\(messageId\)/.test(staleApprovalCompensation) &&
    !/workspaceFetch/.test(staleApprovalCompensation),
);

ok(
  "Dust, MCP, chat, and credential-management calls route through the guarded fetch boundary",
  [
    "/api/mcp/test",
    "/api/dust/test",
    "/api/integrations/dust/config",
    "/api/dust/run",
    "/api/hermes/chat",
    "/api/keys/test",
  ].every((path) => source.includes(`workspaceFetch("${path}`) || source.includes(`workspaceFetch(\`${path}`)),
);

ok(
  "provider, MCP, and model creators reject before returning phantom success while unavailable",
  guardedBefore(actionBody("addProvider", "updateProvider"), /const provider:/) &&
    guardedBefore(actionBody("addMcpServer", "updateMcpServer"), /validateMcpBaseUrl\(/) &&
    guardedBefore(actionBody("addModel", "updateModel"), /const model:/),
);

ok(
  "leaving ready availability aborts every in-flight chat stream",
  /workspaceStatus\.phase !== "ready"[\s\S]{0,260}chatAbortControllers\.current\.values\(\)[\s\S]{0,180}controller\.abort\(\)/.test(source),
);

const sendChat = actionBody("sendChat", "cancelChat");
const toolLoopStart = sendChat.indexOf("if (chatAiCfg");
const streamingStart = sendChat.indexOf("// 4. Live mode", toolLoopStart);
const toolLoop = toolLoopStart >= 0 && streamingStart > toolLoopStart
  ? sendChat.slice(toolLoopStart, streamingStart)
  : "";
ok(
  "non-streaming cloud and MCP chat is registered and abortable when availability leaves ready",
  /const toolLoopController = new AbortController\(\)/.test(toolLoop) &&
    /chatAbortControllers\.current\.set\(threadId, toolLoopController\)/.test(toolLoop) &&
    /workspaceFetch\("\/api\/hermes\/chat",[\s\S]*signal: toolLoopController\.signal/.test(toolLoop) &&
    /chatAbortControllers\.current\.get\(threadId\) === toolLoopController[\s\S]*\.delete\(threadId\)/.test(toolLoop),
);

console.log(`RESULT workspace-effectful-actions: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
