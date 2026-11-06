"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Eye, EyeOff, Lock } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import {
  supabaseEnabled,
  ALLOWED_EMAIL_DOMAIN,
  azureLoginEnabled,
  demoLoginEnabled,
} from "@/lib/supabase/config";
import { AriaLockup } from "@/components/app/logo";
import { TalentField } from "@/components/auth/talent-field";
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
/** Auth errors in the interface's words, with what to do next. */
function signInError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password. Check both and try again.";
  if (/email not confirmed/i.test(message)) return "This account is not confirmed yet. Ask your administrator to activate it.";
  if (/fetch|network/i.test(message)) return "ARIA could not reach the sign-in service. Check that the stack is running, then try again.";
  return message;
}

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
  const [showPassword, setShowPassword] = React.useState(false);

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
    const loginEmail = email.includes("@") ? email : `${email}@aria.local`;
    const { error: err } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (err) {
      setAuthError(signInError(err.message));
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
    <div className="grid min-h-screen grid-cols-1 bg-paper text-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12 lg:px-16">
        <AriaLockup />

        <div className="my-auto w-full max-w-sm py-12 animate-fade-in">
          <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight">
            {localOnly ? "Open ARIA" : "Welcome back"}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-ink-soft">
            Sign in to source, score and contact candidates for Mantu Group roles.
          </p>

          {error && (
            <p role="alert" className="mt-6 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          )}

          <div className="mt-9 space-y-5">
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
              <form id="login-email-form" onSubmit={signInWithEmail} className="space-y-5">
                <Field label="Username or email" htmlFor="login-username">
                  <Input
                    id="login-username"
                    name="username"
                    type="text"
                    required
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={demoLoginEnabled ? "admin" : "name@company.com"}
                    className="h-12"
                  />
                </Field>
                <Field label="Password" htmlFor="login-password">
                  <div className="relative">
                    <Input
                      id="login-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                </Field>
                {authError && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{authError}</span>
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  variant={demoLoginEnabled || showMicrosoft ? "outline" : "secondary"}
                  className="w-full"
                  loading={loading}
                >
                  Sign in
                </Button>
              </form>
            )}

            {authError && !showForm && (
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

      </main>

      <aside
        aria-label="How ARIA handles outreach"
        className="relative hidden overflow-hidden bg-ink text-paper lg:block"
      >
        <TalentField className="absolute inset-0 h-full w-full" />
        {/* Keeps the text legible over the field without a visible box. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink via-ink/90 to-transparent" aria-hidden />
        <div className="relative flex h-full flex-col justify-end px-16 pb-16">
          <div className="max-w-md">
            <h2 className="text-balance text-[1.75rem] font-bold leading-snug tracking-tight">
              Nothing reaches a candidate without you.
            </h2>
            <ol className="mt-8 space-y-5">
              {STEPS.map((step, i) => (
                <li key={step.text} className="flex gap-4">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                      step.human ? "bg-mantu-yellow text-mantu-yellow-ink" : "bg-paper/10 text-paper/70",
                    )}
                  >
                    {i + 1}
                  </span>
                  <p className={cn("pt-0.5 text-[0.9375rem] leading-relaxed", step.human ? "font-semibold text-paper" : "text-paper/70")}>
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-10 border-t border-paper/10 pt-5 text-sm leading-relaxed text-paper/55">
              Sending stays off until a sending domain is connected and verified.
            </p>
          </div>
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
