/** Edge-compatible verification for the Node-minted `<expiry>.<HMAC hex>` demo token. */
export async function verifyDemoTokenAtEdge(token: string | null | undefined, secret: string | undefined): Promise<boolean> {
  if (!token || !secret || secret.length < 16) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiryText, signatureHex] = parts;
  if (!/^\d+$/.test(expiryText) || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = new Uint8Array(signatureHex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
    return await crypto.subtle.verify("HMAC", key, signature, encoder.encode(expiryText));
  } catch {
    return false;
  }
}
