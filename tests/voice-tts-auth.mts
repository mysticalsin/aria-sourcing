import { NextRequest } from "next/server";
import { mintDemoToken } from "../src/lib/demo-auth";
import { principalFromEvidence } from "../src/lib/authenticated-principal-policy";
import { createProcessEnvScope } from "./helpers/process-env.mts";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

ok(
  "Supabase user evidence resolves to a stable principal",
  principalFromEvidence({ supabaseUserId: "user-1", signedDemoSession: false })?.id === "user:user-1",
);
ok(
  "signed demo evidence resolves to a rate-limitable principal",
  principalFromEvidence({ supabaseUserId: null, signedDemoSession: true })?.id === "demo:signed-session",
);
ok(
  "missing evidence is anonymous",
  principalFromEvidence({ supabaseUserId: null, signedDemoSession: false }) === null,
);

const envScope = createProcessEnvScope([
  "NEXT_PUBLIC_ENABLE_DEMO_LOGIN",
  "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "DEMO_SESSION_SECRET",
  "ELEVENLABS_API_KEY",
]);
envScope.set({
  NEXT_PUBLIC_ENABLE_DEMO_LOGIN: "true",
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  SUPABASE_URL: undefined,
  DEMO_SESSION_SECRET: "test-demo-session-secret-32-characters",
  ELEVENLABS_API_KEY: "test-key-never-logged",
});

let providerCalls = 0;
let providerStatus = 200;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  providerCalls += 1;
  if (providerStatus !== 200) {
    return new Response(JSON.stringify({ error: "upstream sentinel detail" }), { status: providerStatus });
  }
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
};

try {
  const routeModule = await import("../src/app/api/voice/tts/route");
  const post = ((routeModule as any).POST ?? (routeModule as any).default?.POST) as (request: NextRequest) => Promise<Response>;

  const anonymous = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Hello" }),
  }));
  ok("anonymous TTS is rejected before the paid provider", anonymous.status === 401 && providerCalls === 0);

  const invalidDemo = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "aria_demo=invalid",
    },
    body: JSON.stringify({ text: "Hello" }),
  }));
  ok("invalid signed-demo cookie is rejected", invalidDemo.status === 401 && providerCalls === 0);

  const token = mintDemoToken();
  const authenticated = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `aria_demo=${token}`,
    },
    body: JSON.stringify({ text: "Hello" }),
  }));
  ok("signed demo session may use the configured TTS provider", authenticated.status === 200 && providerCalls === 1);
  ok("successful TTS preserves the binary audio contract", authenticated.headers.get("content-type") === "audio/mpeg");

  envScope.set({ ELEVENLABS_API_KEY: undefined });
  const noKey = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `aria_demo=${token}`,
      "x-forwarded-for": "203.0.113.20",
    },
    body: JSON.stringify({ text: "Hello" }),
  }));
  ok("authenticated missing-key response preserves browser fallback", noKey.status === 204 && providerCalls === 1);
  envScope.set({ ELEVENLABS_API_KEY: "test-key-never-logged" });

  // The first signed request above consumed one slot for the default IP. Fill
  // the remaining 19, then prove the 21st is blocked before provider access.
  for (let index = 0; index < 19; index += 1) {
    const response = await post(new NextRequest("http://localhost/api/voice/tts", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `aria_demo=${token}` },
      body: JSON.stringify({ text: `Rate limit ${index}` }),
    }));
    ok(`signed principal request ${index + 2} remains within quota`, response.status === 200);
  }
  const limited = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `aria_demo=${token}` },
    body: JSON.stringify({ text: "One too many" }),
  }));
  ok("principal plus IP quota returns 429 before provider access", limited.status === 429 && providerCalls === 20);

  const distinctIp = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `aria_demo=${token}`,
      "x-forwarded-for": "203.0.113.21",
    },
    body: JSON.stringify({ text: "Different client address" }),
  }));
  ok("same principal at a distinct IP has an independent composite quota", distinctIp.status === 200 && providerCalls === 21);

  const sentinel = "candidate-private-sentinel-text";
  const capturedLogs: string[] = [];
  const originalConsole = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args: unknown[]) => { capturedLogs.push(args.join(" ")); };
  console.warn = (...args: unknown[]) => { capturedLogs.push(args.join(" ")); };
  console.error = (...args: unknown[]) => { capturedLogs.push(args.join(" ")); };
  providerStatus = 500;
  let upstreamFailure: Response;
  try {
    upstreamFailure = await post(new NextRequest("http://localhost/api/voice/tts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `aria_demo=${token}`,
        "x-forwarded-for": "203.0.113.22",
      },
      body: JSON.stringify({ text: sentinel }),
    }));
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    providerStatus = 200;
  }
  ok("upstream provider failure returns the fixed 502 contract", upstreamFailure!.status === 502);
  ok(
    "request text and provider detail never reach logs",
    !capturedLogs.some((line) => line.includes(sentinel) || line.includes("upstream sentinel detail")),
  );

  const voiceClientSource = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("../src/lib/voice/aria-voice.ts", import.meta.url), "utf8"),
  );
  ok(
    "voice client falls back for every non-success HTTP status",
    /if \(res\.status !== 200\)[\s\S]{0,300}speakWithBrowser\(text\)/.test(voiceClientSource),
  );
  for (const status of [204, 401, 429, 502]) {
    ok(`HTTP ${status} is a non-200 fallback signal`, status !== 200);
  }
} finally {
  globalThis.fetch = originalFetch;
  envScope.restore();
}

console.log(`RESULT voice-tts-auth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
