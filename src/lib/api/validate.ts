import { NextRequest, NextResponse } from "next/server";
import { ZodSchema, ZodError } from "zod";

/**
 * Shared API input validation helper.
 *
 * - Rejects oversized bodies before buffering.
 * - Parses JSON safely.
 * - Validates the body against the provided Zod schema and returns a
 *   field-level 400 response on failure.
 */
export async function validateBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
  { maxBytes = 32_000 }: { maxBytes?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const payloadTooLarge = () => ({
    ok: false as const,
    response: NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 }),
  });
  const declaredLength = req.headers.get("content-length")?.trim() ?? "";
  if (/^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return payloadTooLarge();
  }

  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return payloadTooLarge();
      }
      chunks.push(value);
    }
  }

  const buf = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Validation failed.",
          issues: formatZodIssues(parsed.error),
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

function formatZodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.length ? issue.path.join(".") : "root",
    message: issue.message,
  }));
}
