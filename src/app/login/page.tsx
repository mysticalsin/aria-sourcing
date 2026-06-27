"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HermesWordmark } from "@/components/app/logo";
import { Button } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { supabaseEnabled, ALLOWED_EMAIL_DOMAIN } from "@/lib/supabase/config";
import { ShieldCheck, Sparkles, Lock, AlertTriangle } from "lucide-react";

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 23 23" className={className} aria-hidden width="18" height="18">
      <rect x="1" y="1" width="10" height="10" fill="#f25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7fba00" />
      <rect x="1" y="12" width="10" height="10" fill="#00a4ef" />
      <rect x="12" y="12" width="10" height="10" fill="#ffb900" />
    </svg>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/";
  const error = params.get("error");
  const [loading, setLoading] = React.useState(false);

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

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink p-12 text-paper lg:flex lg:flex-col lg:justify-between">
        <div className="orbital absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-40" aria-hidden />
        <div className="bg-dot-grid absolute inset-0 opacity-[0.15]" aria-hidden />
        <div className="relative">
          <HermesWordmark className="[&_*]:!text-paper" />
        </div>
        <div className="relative space-y-6">
          <p className="eyebrow text-mantu-yellow">Autonomous recruiting ops</p>
          <h1 className="display text-5xl">
            Source boldly.
            <br />
            Book beyond.
          </h1>
          <p className="max-w-md text-paper/70">
            Hermes turns job requests into booked interviews: human approval, machine speed.
            Sign in with your Microsoft work account to enter the command center.
          </p>
        </div>
        <ul className="relative space-y-2 text-sm text-paper/70">
          <li className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-mantu-yellow" /> Human approval gate on by default
          </li>
          <li className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-mantu-yellow" /> Every touchpoint tracked in your workspace
          </li>
        </ul>
      </section>

      {/* Auth panel */}
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <HermesWordmark />
          </div>
          <p className="eyebrow mb-2">Welcome back</p>
          <h2 className="display text-3xl text-ink">Sign in to Hermes</h2>
          <p className="mt-2 text-sm text-muted">
            {supabaseEnabled
              ? "Use your Microsoft work account to continue."
              : "Supabase isn’t configured — explore the open demo instead."}
          </p>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="mt-7 space-y-3">
            {supabaseEnabled ? (
              <Button
                onClick={signInWithMicrosoft}
                loading={loading}
                size="lg"
                variant="primary"
                className="w-full justify-center"
                leftIcon={<MicrosoftLogo />}
              >
                Continue with Microsoft
              </Button>
            ) : (
              <Button
                onClick={() => router.push("/")}
                size="lg"
                variant="primary"
                className="w-full justify-center"
                leftIcon={<Sparkles className="h-4 w-4" />}
              >
                Enter the demo
              </Button>
            )}

            {ALLOWED_EMAIL_DOMAIN && supabaseEnabled && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <Lock className="h-3.5 w-3.5" />
                Restricted to @{ALLOWED_EMAIL_DOMAIN} accounts
              </p>
            )}
          </div>

          <p className="mt-10 text-xs leading-relaxed text-muted">
            Synthetic data · dry-run mode · no candidate is contacted without approval. By
            continuing you agree this is a demonstration environment.
          </p>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <LoginInner />
    </Suspense>
  );
}
