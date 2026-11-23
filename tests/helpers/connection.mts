/** Give a request its own connection address so rate-limit buckets stay isolated in tests. */
export function isolateConnection<T extends object>(req: T): T {
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: `synthetic-${crypto.randomUUID()}` },
  });
  return req;
}
