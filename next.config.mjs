import path from "node:path";

/**
 * Turbopack deliberately rejects output directories outside its project root.
 * Keep this setting relative and use `npm run build:isolated` when a synced
 * checkout needs its build artifacts kept in a temporary workspace.
 */
export function resolveNextDistDir(configuredDistDir) {
  if (!configuredDistDir) return ".next";
  if (path.isAbsolute(configuredDistDir)) {
    throw new Error(
      "NEXT_DIST_DIR must be relative. Turbopack cannot build outside the project root; use `npm run build:isolated` instead.",
    );
  }

  return configuredDistDir;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone/server.js) for the Fly
  // production container (Dockerfile.prod). Vercel ignores it; local dev unaffected.
  output: "standalone",
  // Do not advertise the framework via X-Powered-By (information disclosure).
  poweredByHeader: false,
  // Defaults to `.next` so CI/Vercel are unaffected. For synced checkouts,
  // `build:isolated` creates a temporary copy rather than escaping this root.
  distDir: resolveNextDistDir(process.env.NEXT_DIST_DIR),
  async headers() {
    // Security headers for a console that renders candidate PII.
    const isProd = process.env.NODE_ENV === "production";
    // 'unsafe-eval' is only needed by Next's dev/HMR runtime; drop it in prod.
    // 'unsafe-inline' is kept because Next injects inline hydration scripts
    // (and Recharts inline styles) without a nonce in this app.
    const scriptSrc = isProd
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    // connect-src: always allow hosted Supabase (Vercel demo) + the self-hosted Fly Kong
    // gateway (Fly prod). Local Supabase on :54321 is dev-only (compose end-to-end).
    const connectSrc = [
      "connect-src 'self' blob:",
      "https://*.supabase.co wss://*.supabase.co",
      "https://aria-mantu-kong.fly.dev wss://aria-mantu-kong.fly.dev",
      ...(isProd
        ? []
        : ["http://127.0.0.1:54321 ws://127.0.0.1:54321 http://localhost:54321 ws://localhost:54321"]),
    ].join(" ");
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Login hero background video (CloudFront).
      "media-src 'self' blob: https://d8j0ntlcm91z4.cloudfront.net",
      // blob: lets three's GLTFLoader fetch each GLB's own embedded textures
      // (same-origin in-memory data the page itself creates).
      connectSrc,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
      {
        source: "/unsubscribe/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/unsubscribe/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
