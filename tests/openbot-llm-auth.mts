/**
 * OpenBot LLM auth: OpenBot must present Aria's PROVIDER_ENV API key.
 */
import assert from "node:assert/strict";
import {
  authorizeOpenBotLlm,
  listAriaLlmProviders,
  resolveAriaLlmProvider,
} from "../src/lib/openbot/llm-auth";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const env = {
  OPENAI_API_KEY: "sk-aria-openai",
  ANTHROPIC_API_KEY: "sk-aria-anthropic",
} as NodeJS.ProcessEnv;

ok("lists Aria provider keys", listAriaLlmProviders(env).length === 2);
ok("default provider is openai (slug order)", resolveAriaLlmProvider(env)?.slug === "openai");
ok(
  "preferred anthropic when keyed",
  resolveAriaLlmProvider({ ...env, OPENBOT_LLM_PROVIDER: "anthropic" })?.slug === "anthropic",
);

const withOpenAi = authorizeOpenBotLlm("Bearer sk-aria-openai", env);
ok("accepts Aria OPENAI_API_KEY", withOpenAi.ok && withOpenAi.auth === "aria_api_key");
ok(
  "uses matched openai key upstream",
  withOpenAi.ok && withOpenAi.provider.key === "sk-aria-openai",
);

const withAnthropic = authorizeOpenBotLlm("Bearer sk-aria-anthropic", env);
ok(
  "accepts Aria ANTHROPIC_API_KEY as same-key auth",
  withAnthropic.ok && withAnthropic.provider.slug === "anthropic",
);

const denied = authorizeOpenBotLlm("Bearer other-key", env);
ok("rejects unknown bearer", !denied.ok && denied.reason === "unauthorized");

const withProxy = authorizeOpenBotLlm("Bearer proxy-only", {
  ...env,
  OPENBOT_LLM_PROXY_TOKEN: "proxy-only",
});
ok(
  "optional proxy token still spends Aria key",
  withProxy.ok && withProxy.auth === "proxy_token" && withProxy.provider.key === "sk-aria-openai",
);

const noKeys = authorizeOpenBotLlm("Bearer anything", {} as NodeJS.ProcessEnv);
ok("missing Aria key → not ready", !noKeys.ok && noKeys.reason === "missing_aria_key");

console.log(`RESULT openbot-llm-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
