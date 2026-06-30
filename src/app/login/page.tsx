"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Menu, X, AlertTriangle, Lock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { supabaseEnabled, ALLOWED_EMAIL_DOMAIN, demoLoginEnabled } from "@/lib/supabase/config";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

const NAV_LINKS = ["Platform", "Fleet", "Security", "Contact"];

/** Only allow same-origin path redirects (blocks open-redirect to external sites).
 *  Rejects protocol-relative `//host` and the backslash bypass `/\host` (browsers
 *  normalise `\` to `/`, turning it into a protocol-relative external redirect). */
const safeRedirect = (r: string) =>
  r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : "/";

/** Splits text into characters and fades each in with a 0.07s stagger, once in view. */
function StaggeredFade({ text }: { text: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <span ref={ref} aria-label={text}>
      {text.split("").map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden
          style={{ display: "inline-block" }}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0 }}
          transition={{ delay: i * 0.07, duration: 0.5, ease: "easeOut" }}
        >
          {ch === " " ? " " : ch}
        </motion.span>
      ))}
    </span>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const error = params.get("error");
  const [loading, setLoading] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [showEmail, setShowEmail] = React.useState(true);
  const [email, setEmail] = React.useState("admin");
  const [password, setPassword] = React.useState("admin");
  const [authError, setAuthError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Respect prefers-reduced-motion for the background hero video: only play /
  // loop it when the user hasn't asked the OS to reduce motion. Controlled here
  // (not via the `autoPlay`/`loop` attributes) so the preference is honoured on
  // mount and when it changes, and so the global reduced-motion CSS — which only
  // covers CSS animations, not native video playback — isn't relied on.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (mq.matches) {
        v.loop = false;
        v.pause();
      } else {
        v.loop = true;
        void v.play().catch(() => {});
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const signInWithMicrosoft = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoading(true);
    const origin = window.location.origin;
    const redirectTo = `${origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: { scopes: "openid email profile offline_access", redirectTo },
    });
    if (err) setLoading(false);
  };

  // One-click demo sign-in: admin/admin is resolved SERVER-SIDE (the real account
  // password never reaches the client bundle). Used by both the hero CTA (when
  // NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true) and the admin/admin email-form path.
  const runDemoLogin = async () => {
    setLoading(true);
    setAuthError(null);
    const res = await fetch("/api/auth/demo-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    if (res.ok) {
      window.location.href = safeRedirect(redirect);
      return;
    }
    setAuthError("Demo login is unavailable.");
    setLoading(false);
  };

  const signInWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);
    if (email.trim() === "admin" && password === "admin") {
      await runDemoLogin();
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    const loginEmail = email.includes("@") ? email : `${email}@hermes.local`;
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (err) {
      setAuthError(err.message);
      setLoading(false);
    } else {
      // Full reload so the store re-hydrates with the authenticated session.
      window.location.href = safeRedirect(redirect);
    }
  };

  const handleCTA = () => {
    if (demoLoginEnabled) void runDemoLogin();
    else if (supabaseEnabled) void signInWithMicrosoft();
    else router.push(safeRedirect(redirect));
  };

  const ctaText = loading
    ? "Signing in…"
    : demoLoginEnabled
      ? "Enter the demo console"
      : supabaseEnabled
        ? "Sign in with Microsoft"
        : "Enter the console";

  return (
    <div className="login-hero relative flex h-screen w-screen flex-col overflow-hidden bg-[#010101] text-white">
      {/* Background video */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover object-center"
        muted
        loop
        playsInline
        poster=""
        aria-hidden
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>
      {/* Legibility overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" aria-hidden />

      {/* Navigation */}
      <nav className="relative z-20 flex items-center justify-between px-5 py-6 sm:px-8 md:justify-center">
        <span className="flex items-center md:absolute md:left-8">
          {/* Full transparent logo (white ARIA reads on the dark hero) — shown whole. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aria-logo.png" alt="Aria: Agentic Sourcing Platform by Mantu" className="h-16 w-auto object-contain" />
        </span>
        <div className="hidden items-center gap-10 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l}
              href="#"
              className="text-xs uppercase tracking-[0.2em] text-white/80 transition-colors duration-300 hover:text-white"
            >
              {l}
            </a>
          ))}
        </div>
        <button
          type="button"
          className="text-white md:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-white/60 md:absolute md:right-8 md:block">
          by Mantu
        </span>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="mobile-menu-glass fixed left-4 right-4 top-16 z-50 flex flex-col items-center gap-5 rounded-2xl py-8 md:hidden"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {NAV_LINKS.map((l, i) => (
              <motion.a
                key={l}
                href="#"
                onClick={() => setMenuOpen(false)}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.06 }}
                className="text-sm font-light uppercase tracking-[0.25em] text-white/90 transition-colors hover:text-white"
              >
                {l}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero content */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 pb-16 pt-12 text-center sm:px-8 sm:pt-16 md:pt-24">
        <h1 className="font-garamond mb-6 text-4xl font-normal leading-[1.08] tracking-tight text-white sm:mb-8 sm:text-6xl md:text-8xl lg:text-9xl">
          <span className="block">
            <StaggeredFade text="HUMAN APPROVAL" />
          </span>
          <span className="block">
            <StaggeredFade text="MACHINE SPEED" />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 1.6 }}
          className="mb-8 max-w-xs text-sm font-light leading-relaxed text-white/70 sm:mb-10 sm:max-w-md sm:text-base md:text-lg"
        >
          A fleet of autonomous agents that source, write, and book.
          <br className="hidden sm:block" /> Every message held for your sign-off.
        </motion.p>

        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 2.0 }}
          onClick={handleCTA}
          disabled={loading}
          className="liquid-glass rounded-full px-7 py-3.5 text-sm font-light uppercase tracking-[0.18em] text-white/90 disabled:opacity-70 sm:px-10 sm:py-4 sm:tracking-[0.2em]"
        >
          {ctaText}
        </motion.button>

        {supabaseEnabled && (
          <div className="mt-5 w-full max-w-xs">
            <button
              type="button"
              onClick={() => setShowEmail((v) => !v)}
              className="text-xs uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white/80"
            >
              {showEmail ? "Hide email sign-in" : "Sign in with email"}
            </button>
            <AnimatePresence>
              {showEmail && (
                <motion.form
                  onSubmit={signInWithEmail}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="mt-4 flex flex-col gap-3 overflow-hidden"
                >
                  <label htmlFor="login-username" className="sr-only">
                    Username or email
                  </label>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin"
                    className="rounded-full bg-white/5 px-5 py-3 text-sm text-white placeholder-white/40 outline-none ring-1 ring-inset ring-white/15 transition focus:ring-white/40"
                  />
                  <label htmlFor="login-password" className="sr-only">
                    Password
                  </label>
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="rounded-full bg-white/5 px-5 py-3 text-sm text-white placeholder-white/40 outline-none ring-1 ring-inset ring-white/15 transition focus:ring-white/40"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="liquid-glass rounded-full px-7 py-3 text-sm font-light uppercase tracking-[0.18em] text-white/90 disabled:opacity-70"
                  >
                    {loading ? "Signing in…" : "Sign in"}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
            {authError && <p className="mt-3 text-xs text-red-300">{authError}</p>}
          </div>
        )}

        {ALLOWED_EMAIL_DOMAIN && supabaseEnabled && (
          <p className="mt-5 flex items-center gap-1.5 text-xs text-white/50">
            <Lock className="h-3.5 w-3.5" />
            Restricted to @{ALLOWED_EMAIL_DOMAIN} accounts
          </p>
        )}

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-full bg-red-500/15 px-4 py-2 text-xs text-red-200 ring-1 ring-inset ring-red-400/20">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="mt-10 max-w-sm text-[0.7rem] font-light leading-relaxed text-white/40">
          No candidate is contacted without your explicit approval. Nothing sends until you connect
          and verify a sending domain.
        </p>

        <p className="mt-6 text-xs font-light tracking-[0.18em] text-white/50">
          Designed &amp; built by{" "}
          <a
            href="https://www.linkedin.com/in/tonywalteur/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-normal text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Tony Walteur
          </a>
        </p>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-[#010101]" />}>
      <LoginInner />
    </Suspense>
  );
}
