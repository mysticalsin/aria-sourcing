import { NextRequest } from "next/server";

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

process.env.NODE_ENV = "production";
delete process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_URL;
process.env.ELEVENLABS_API_KEY = "test-key-never-logged";

let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  providerCalls += 1;
  return new Response(new Uint8Array([1]), { status: 200 });
};

try {
  const routeModule = await import("../src/app/api/voice/tts/route");
  const post = ((routeModule as any).POST ?? (routeModule as any).default?.POST) as (request: NextRequest) => Promise<Response>;
  const response = await post(new NextRequest("http://localhost/api/voice/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Hello" }),
  }));
  ok("production without its authentication backend fails closed", response.status === 503);
  ok("production fail-closed response never reaches the paid provider", providerCalls === 0);
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`RESULT voice-tts-production-fail-closed: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
