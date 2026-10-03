const EMPTY = new Uint8Array(0);

export class BoundedResponseError extends Error {
  constructor(message = "Response exceeded the configured byte limit.") {
    super(message);
    this.name = "BoundedResponseError";
  }
}

/**
 * Read a WHATWG response stream without ever buffering more than maxBytes.
 * Content-Length is only an early rejection hint; the streamed byte count is
 * authoritative because chunked or dishonest upstreams may omit or forge it.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer.");
  }

  const declaredHeader = response.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new BoundedResponseError();
    }
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value = EMPTY } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedResponseError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total).toString("utf8");
}

export function responseOriginMatches(response: Response, expected: URL): boolean {
  if (!response.url) return false;
  try {
    return new URL(response.url).origin === expected.origin;
  } catch {
    return false;
  }
}
