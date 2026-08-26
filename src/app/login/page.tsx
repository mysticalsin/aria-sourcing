"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { AlertTriangle, Lock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  supabaseEnabled,
  ALLOWED_EMAIL_DOMAIN,
  azureLoginEnabled,
  demoLoginEnabled,
} from "@/lib/supabase/config";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260619_191346_9d19d66e-86a4-47f7-8dc6-712c1788c3b2.mp4";

/** Only allow same-origin path redirects (blocks open-redirect to external sites).
 *  Rejects protocol-relative `//host` and the backslash bypass `/\host` (browsers
 *  normalise `\` to `/`, turning it into a protocol-relative external redirect). */
const safeRedirect = (r: string) =>
  r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : "/";

/** Splits text into characters and fades each in with a 0.07s stagger, once in view. */
function StaggeredFade({ text }: { text: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reducedMotion = usePrefersReducedMotion();
  if (reducedMotion) return <span ref={ref}>{text}</span>;
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
  const reducedMotion = usePrefersReducedMotion();
  const [videoPausedByUser, setVideoPausedByUser] = React.useState(false);
  const [showEmail, setShowEmail] = React.useState(true);
  const [email, setEmail] = React.useState(demoLoginEnabled ? "admin" : "");
  const [password, setPassword] = React.useState(demoLoginEnabled ? "admin" : "");
  const [authError, setAuthError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);

  // Respect prefers-reduced-motion for the background hero video: only play /
  // loop it when the user hasn't asked the OS to reduce motion. Controlled here
  // (not via the `autoPlay`/`loop` attributes) so the preference is honoured on
  // mount and when it changes, and so the global reduced-motion CSS — which only
  // covers CSS animations, not native video playback — isn't relied on.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (reducedMotion || videoPausedByUser) {
      v.loop = false;
      v.pause();
    } else {
      v.loop = true;
      void v.play().catch(() => {});
    }
  }, [reducedMotion, videoPausedByUser]);

  const signInWithMicrosoft = async () => {
    if (!azureLoginEnabled) return;
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

  // One-click demo sign-in: admin/admin is resolved SERVER-SIDE. This path is
  // available only when NEXT_PUBLIC_ENABLE_DEMO_LOGIN explicitly marks the
  // deployment as a synthetic public demo.
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
    if (email.trim() === "admin" && password === "admin" && demoLoginEnabled) {
      await runDemoLogin();
      return;
    }
    if (!supabaseEnabled) {
      setAuthError("Use admin / admin to enter the demo.");
      setLoading(false);
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
    // Explicit public demo: one-click admin/admin sign-in. runDemoLogin sets the
    // demo-backed session and then redirects.
    if (demoLoginEnabled) void runDemoLogin();
    else if (supabaseEnabled && azureLoginEnabled) void signInWithMicrosoft();
    else if (supabaseEnabled) {
      setShowEmail(true);
      window.requestAnimationFrame(() => emailRef.current?.focus());
    }
    else router.push(safeRedirect(redirect));
  };

  const ctaText = loading
    ? "Signing in…"
    : demoLoginEnabled
      ? "Enter the demo console"
      : supabaseEnabled
        ? azureLoginEnabled ? "Sign in with Microsoft" : "Sign in with email"
        : "Enter the console";

  return (
    <div className="login-hero relative flex h-screen w-full flex-col overflow-hidden bg-[#010101] text-white">
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

      <nav className="relative z-20 flex items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <span className="flex items-center md:absolute md:left-8">
          {/* Full Aria brand logo (M + ARIA wordmark) — the real logo, not the bare M. */}
          <img src="/aria-logo.png" alt="Aria — Agentic Sourcing Platform by Mantu" className="h-16 w-auto object-contain sm:h-20" />
        </span>
        <span className="hidden text-xs uppercase tracking-[0.2em] text-white/60 md:absolute md:right-8 md:block">
          by Mantu
        </span>
      </nav>

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

        {(supabaseEnabled || demoLoginEnabled) && (
          <div className="mt-5 w-full max-w-xs">
            <button
              type="button"
              onClick={() => setShowEmail((v) => !v)}
              aria-expanded={showEmail}
              aria-controls="login-email-form"
              className="text-xs uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-white/80"
            >
              {showEmail ? "Hide email sign-in" : "Sign in with email"}
            </button>
            <AnimatePresence>
              {showEmail && (
                <motion.form
                  id="login-email-form"
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
                    ref={emailRef}
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={demoLoginEnabled ? "admin" : "name@company.com"}
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

        <p className="mt-10 max-w-sm text-[0.7rem] font-light leading-relaxed text-white/70">
          No candidate is contacted without your explicit approval. Nothing sends until you connect
          and verify a sending domain.
        </p>

        <p className="mt-6 text-xs font-light tracking-[0.18em] text-white/50">
          Designed &amp; built by{" "}
          <a
            href="https://www.linkedin.com/in/tonywalteur/"
            target="_blank"
            rel="noreferrer"
            className="font-normal text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Tony Walteur
          </a>
        </p>
      </main>

      {/* Background-motion toggle — pinned bottom-left so it never overlaps the logo. */}
      <button
        type="button"
        className="absolute bottom-5 left-5 z-20 rounded-full border border-white/20 bg-black/20 px-3.5 py-2 text-[0.65rem] uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm transition-[border-color,color,background-color] duration-150 hover:border-white/40 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-70 sm:bottom-6 sm:left-8"
        onClick={() => setVideoPausedByUser((paused) => !paused)}
        aria-pressed={reducedMotion || videoPausedByUser}
        disabled={reducedMotion}
      >
        {reducedMotion ? "Background motion paused by system" : videoPausedByUser ? "Play background motion" : "Pause background motion"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full bg-[#010101]" />}>
      <LoginInner />
    </Suspense>
  );
}
