const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackRequestUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return LOOPBACK_HOSTS.has(url.hostname);
}

export function assertHarnessUrls({ appUrl, odooUrl }) {
  if (!isLoopbackRequestUrl(appUrl)) {
    throw new Error("APP_URL is not a loopback origin");
  }
  if (odooUrl && !isLoopbackRequestUrl(odooUrl)) {
    throw new Error("ODOO_URL is not a loopback origin");
  }
}
