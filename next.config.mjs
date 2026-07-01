/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework via X-Powered-By (information disclosure).
  poweredByHeader: false,
  // Allow relocating the build dir off a synced drive — OneDrive corrupts `.next`
  // mid-write on this checkout. Defaults to `.next` so CI/Vercel are unaffected;
  // set NEXT_DIST_DIR to a local, non-synced path for dev (e.g. NEXT_DIST_DIR=/tmp/aria-next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    // Security headers for a console that renders candidate PII.
    const isProd = process.env.NODE_ENV === "production";
    // 'unsafe-eval' is only needed by Next's dev/HMR runtime; drop it in prod.
    // 'unsafe-inline' is kept because Next injects inline hydration scripts
    // (and Recharts inline styles) without a nonce in this app.
    const scriptSrc = isProd
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
    const csp = [
      "default-src 'self'",
      scriptSrc,
      // Google Fonts + onlinewebfonts stylesheets for the cinematic login hero.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://db.onlinewebfonts.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com https://db.onlinewebfonts.com",
      // Login hero background video (CloudFront).
      "media-src 'self' blob: https://d8j0ntlcm91z4.cloudfront.net",
      // blob: lets three's GLTFLoader fetch each GLB's own embedded textures
      // (same-origin in-memory data the page itself creates).
      // Local Supabase (127.0.0.1:54321) added for local end-to-end runs; cloud uses *.supabase.co.
      "connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321 http://localhost:54321 ws://localhost:54321",
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
