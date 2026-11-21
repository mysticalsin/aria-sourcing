import { createHash, createHmac, randomBytes } from "node:crypto";

/** SHA-256 of the retired sample HMAC value. The sample itself is not stored. */
export const RETIRED_JWT_SECRET_SHA256 = "1453cea2dc3799e9026e42b3e465e455256d5a149582e4c5b92d4c8d604731a2";

export function jwtSecretAcceptable(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32 || /\s/.test(secret)) return false;
  const digest = createHash("sha256").update(secret).digest("hex");
  return digest !== RETIRED_JWT_SECRET_SHA256;
}

function mintRoleJwt(role, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const issuedAt = 1_700_000_000;
  const payload = Buffer.from(JSON.stringify({
    role,
    iss: "aria-local",
    iat: issuedAt,
    exp: issuedAt + 60 * 60 * 24 * 365 * 5,
  })).toString("base64url");
  const body = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** Fill unset local JWT env with generated values. Refuses a short or retired secret. */
export function ensureLocalJwtEnv(env = process.env) {
  if (!env.SUPABASE_JWT_SECRET) env.SUPABASE_JWT_SECRET = randomBytes(32).toString("base64url");
  if (!jwtSecretAcceptable(env.SUPABASE_JWT_SECRET)) {
    throw new Error("SUPABASE_JWT_SECRET is refused");
  }
  if (!env.SUPABASE_ANON_KEY) env.SUPABASE_ANON_KEY = mintRoleJwt("anon", env.SUPABASE_JWT_SECRET);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) env.SUPABASE_SERVICE_ROLE_KEY = mintRoleJwt("service_role", env.SUPABASE_JWT_SECRET);
  return env;
}
