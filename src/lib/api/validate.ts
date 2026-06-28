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
  // Enforce the byte cap against actually-received bytes, not the client-controlled
  // Content-Length header (absent or spoofable → the old check was bypassable).
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 }),
    };
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
