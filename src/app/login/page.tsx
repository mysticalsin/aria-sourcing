"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Lock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  supabaseEnabled,
  ALLOWED_EMAIL_DOMAIN,
  azureLoginEnabled,
  demoLoginEnabled,
} from "@/lib/supabase/config";
import { HermesMark } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Only allow same-origin path redirects (blocks open-redirect to external sites).
 *  Rejects protocol-relative `//host` and the backslash bypass `/\host` (browsers
 *  normalise `\` to `/`, turning it into a protocol-relative external redirect). */
const safeRedirect = (r: string) =>
  r.startsWith("/") && !r.startsWith("//") && !r.startsWith("/\\") ? r : "/";

/** The approval rule, shown as the real sequence it is. The human step is the
 *  only accented element on the page. */
const STEPS = [
  { text: "ARIA finds candidates who match your brief.", human: false },
  { text: "ARIA drafts a message for each of them.", human: false },
  { text: "You read and approve each message. Only then is it sent.", human: true },
];

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const error = params.get("error");
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState(demoLoginEnabled ? "admin" : "");
  const [password, setPassword] = React.useState(demoLoginEnabled ? "admin" : "");
  const [authError, setAuthError] = React.useState<string | null>(null);

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
    setAuthError("Demo sign-in is unavailable. Try again, or sign in with your account below.");
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

  const showMicrosoft = supabaseEnabled && azureLoginEnabled;
  const showForm = supabaseEnabled || demoLoginEnabled;
  // No auth backend and no public demo: the app runs on synthetic data in the browser.
  const localOnly = !showForm;

  return (
    <div className="grid min-h-screen grid-cols-1 bg-paper text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <div className="flex items-center gap-3">
          <HermesMark className="h-8" />
          <span className="text-lg font-extrabold tracking-[0.3em] text-ink">ARIA</span>
        </div>

        <div className="my-auto w-full max-w-sm py-12">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight">
            {localOnly ? "Open ARIA" : "Sign in to ARIA"}
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
            Sourcing and outreach for Mantu Group recruiters.
          </p>

          {error && (
            <p role="alert" className="mt-6 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <div className="mt-8 space-y-4">
            {demoLoginEnabled && (
              <Button type="button" size="lg" className="w-full" loading={loading} onClick={() => void runDemoLogin()}>
                Enter the demo
              </Button>
            )}

            {showMicrosoft && (
              <Button type="button" size="lg" className="w-full" loading={loading} onClick={() => void signInWithMicrosoft()}>
                Sign in with Microsoft
              </Button>
            )}

            {localOnly && (
              <>
                <Button type="button" size="lg" className="w-full" onClick={() => router.push(safeRedirect(redirect))}>
                  Open the demo workspace
                </Button>
                <p className="text-sm leading-relaxed text-muted">
                  No sign-in is configured on this machine, so ARIA runs on synthetic data in your
                  browser. Nothing is stored and nothing is sent.
                </p>
              </>
            )}

            {showForm && (demoLoginEnabled || showMicrosoft) && (
              <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                {demoLoginEnabled ? "or use the demo credentials" : "or use your email"}
                <span className="h-px flex-1 bg-line" />
              </div>
            )}

            {showForm && (
              <form id="login-email-form" onSubmit={signInWithEmail} className="space-y-4">
                <Field label="Username or email" htmlFor="login-username">
                  <Input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={demoLoginEnabled ? "admin" : "name@company.com"}
                  />
                </Field>
                <Field label="Password" htmlFor="login-password">
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  size="lg"
                  variant={demoLoginEnabled || showMicrosoft ? "outline" : "primary"}
                  className="w-full"
                  loading={loading}
                >
                  Sign in
                </Button>
              </form>
            )}

            {authError && (
              <p role="alert" className="text-sm text-danger">
                {authError}
              </p>
            )}

            {ALLOWED_EMAIL_DOMAIN && supabaseEnabled && (
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Restricted to @{ALLOWED_EMAIL_DOMAIN} accounts
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-muted">ARIA is a Mantu Group product.</p>
      </main>

      <aside
        aria-label="How ARIA handles outreach"
        className="hidden flex-col justify-center bg-ink px-16 py-12 text-paper lg:flex"
      >
        <div className="max-w-md">
          <h2 className="text-2xl font-bold leading-snug tracking-tight">
            Nothing reaches a candidate without you.
          </h2>
          <ol className="mt-10 space-y-7">
            {STEPS.map((step, i) => (
              <li key={step.text} className="flex gap-4">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                    step.human ? "bg-mantu-yellow text-mantu-yellow-ink" : "bg-paper/10 text-paper/70",
                  )}
                >
                  {i + 1}
                </span>
                <p className={cn("pt-1 text-[0.9375rem] leading-relaxed", step.human ? "font-semibold text-paper" : "text-paper/70")}>
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-12 border-t border-paper/10 pt-6 text-sm leading-relaxed text-paper/60">
            Sending stays off until a sending domain is connected and verified.
          </p>
        </div>
      </aside>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <LoginInner />
    </Suspense>
  );
}
