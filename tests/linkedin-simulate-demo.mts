/**
 * LinkedIn simulate route — demo mode must return a durable event payload
 * (status recorded), not a dry-run that cannot write.
 */
import { mock } from "node:test";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN = "true";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_URL;

const moduleUrl = (path: string) => new URL(`../${path}`, import.meta.url).href;

mock.module(moduleUrl("src/lib/supabase/config.ts"), {
  namedExports: {
    supabaseEnabled: false,
    prodFailClosed: () => null,
    isProduction: false,
    demoLoginEnabled: true,
  },
});

const { POST } = await import("../src/app/api/linkedin/simulate/route");

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL: ${name}`);
  }
}

{
  const req = new NextRequest("http://localhost/api/linkedin/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventType: "reply",
      profileUrl: "https://www.linkedin.com/in/test-candidate",
      body: "Yes, interested.",
      eventId: "sim:reply:route-test-1",
    }),
  });
  const res = await POST(req);
  const json = (await res.json()) as {
    ok?: boolean;
    status?: string;
    demo?: boolean;
    event?: { event_id?: string; body?: string; inbound_id?: string | null };
    classifyQueued?: boolean;
  };
  ok("demo simulate HTTP 200", res.status === 200);
  ok("demo simulate ok", json.ok === true);
  ok("demo simulate status recorded", json.status === "recorded");
  ok("demo simulate marks demo", json.demo === true);
  ok("demo simulate returns event payload", json.event?.event_id === "sim:reply:route-test-1");
  ok("demo simulate preserves body", json.event?.body === "Yes, interested.");
  ok("demo reply has inbound id", typeof json.event?.inbound_id === "string");
  ok("demo classify not queued without DB", json.classifyQueued === false);
}

{
  const req = new NextRequest("http://localhost/api/linkedin/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventType: "reply",
      profileUrl: "https://www.linkedin.com/in/test-candidate",
      body: "",
    }),
  });
  const res = await POST(req);
  const json = (await res.json()) as { ok?: boolean; error?: string };
  ok("reply without body fails", res.status === 400 && json.ok === false);
}

{
  const req = new NextRequest("http://localhost/api/linkedin/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventType: "connection_accepted",
      profileUrl: "https://www.linkedin.com/in/test-candidate",
    }),
  });
  const res = await POST(req);
  const json = (await res.json()) as {
    ok?: boolean;
    status?: string;
    event?: { inbound_id?: string | null; event_type?: string };
  };
  ok("lifecycle simulate recorded", res.status === 200 && json.status === "recorded");
  ok("lifecycle has no inbound", json.event?.inbound_id === null);
}

console.log(`RESULT linkedin-simulate-demo: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
