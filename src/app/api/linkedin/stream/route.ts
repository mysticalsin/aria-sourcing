// Experimental LinkedIn bridge: live updates for the signed-in user's inbox
// page, as Server-Sent Events. The stream checks a cheap fingerprint of the
// account (heartbeat, conversations, outbox, candidate contacts) every TICK_MS and sends a
// "change" event naming the parts that moved; the page then refetches only
// those. It ends after STREAM_MS and EventSource reconnects on its own.

import type { NextRequest } from "next/server";
import { bridgeVersion, requireBridgeUser, type BridgeVersion } from "@/lib/linkedin-bridge/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 1_500;
const KEEPALIVE_MS = 15_000;
const STREAM_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const auth = await requireBridgeUser(req);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const encoder = new TextEncoder();
  let closed = false;
  req.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      write("retry: 2000\n\n");
      let last: BridgeVersion | null = null;
      let lastWrite = Date.now();
      const end = Date.now() + STREAM_MS;
      while (!closed && Date.now() < end) {
        try {
          const version = await bridgeVersion(ctx);
          const changed = last
            ? (Object.keys(version) as (keyof BridgeVersion)[]).filter((key) => version[key] !== last![key])
            : (["status", "inbox", "outbox", "contacts"] as const);
          if (changed.length) {
            write(`event: change\ndata: ${JSON.stringify({ parts: changed })}\n\n`);
            lastWrite = Date.now();
          }
          last = version;
        } catch {
          // A failed read is not a change; try again on the next tick.
        }
        if (Date.now() - lastWrite > KEEPALIVE_MS) {
          write(": keep-alive\n\n");
          lastWrite = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));
      }
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
