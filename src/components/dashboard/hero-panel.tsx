"use client";

import * as React from "react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import {
  FIRST_RUN_GUIDE_STEPS,
  type CommandCenterMode,
  type CommandCenterNextStep,
} from "@/lib/command-center-firstrun";
import { FilePlus2, MailCheck, Sparkles } from "lucide-react";

type HeroPanelProps = {
  mode?: CommandCenterMode;
  nextStep?: CommandCenterNextStep;
};

export function HeroPanel({ mode = "returning", nextStep }: HeroPanelProps) {
  if (mode === "first_run") {
    return <FirstRunHero nextStep={nextStep} />;
  }
  return <ReturningHero nextStep={nextStep} />;
}

function FirstRunHero({ nextStep }: { nextStep?: CommandCenterNextStep }) {
  const cta = nextStep?.cta ?? "Paste a job brief";
  const reason =
    nextStep?.reason ??
    "Aria will find people and draft messages — you approve before anything sends.";
  const href = nextStep?.href ?? "/campaigns/new";

  return (
    <section
      data-tour="home-hero"
      className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-7 py-12 shadow-soft animate-fade-in sm:px-12 sm:py-16"
      data-testid="cc-hero-first-run"
      aria-labelledby="cc-first-run-title"
    >
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-50" aria-hidden />
      <div
        className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-tangerine/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-10 right-16 h-56 w-56 rounded-full bg-electric/15 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 max-w-3xl">
        <Eyebrow className="text-tangerine">Get started</Eyebrow>

        <h1 id="cc-first-run-title" className="display mt-4 text-4xl text-ink sm:text-5xl lg:text-6xl">
          Paste a job. Aria finds people.
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">{reason}</p>

        <div className="mt-8">
          <Link
            href={href}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-base font-semibold text-paper shadow-soft transition-all duration-150 hover:bg-ink/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <FilePlus2 className="h-5 w-5" aria-hidden />
            {cta}
          </Link>
        </div>

        <ol className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FIRST_RUN_GUIDE_STEPS.map((step, index) => (
            <li key={step.id} className="rounded-2xl border border-line/70 bg-canvas/40 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Step {index + 1}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ReturningHero({ nextStep }: { nextStep?: CommandCenterNextStep }) {
  // One header, one primary action: the next step. Secondary actions live in
  // the command bar below the hero.
  const primaryHref = nextStep?.href ?? "/campaigns/new";
  const primaryLabel = nextStep?.cta ?? "New campaign";

  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-7 py-10 shadow-soft animate-fade-in sm:px-12 sm:py-12"
      data-testid="cc-hero-returning"
      data-tour="home-hero"
      aria-labelledby="cc-returning-title"
    >
      <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-50" aria-hidden />
      <div
        className="orbital pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full opacity-30 animate-spin-slow"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-tangerine/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-10 right-16 h-56 w-56 rounded-full bg-electric/15 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 max-w-3xl">
        <Eyebrow className="text-tangerine">Command Center</Eyebrow>

        <h1 id="cc-returning-title" className="display mt-4 text-4xl text-ink sm:text-5xl lg:text-6xl">
          {nextStep?.reason?.startsWith("Acting on ")
            ? nextStep.reason.replace(/^Acting on /, "")
            : "Your next move is ready."}
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          {nextStep?.reason ??
            "Source talent, approve outreach, and book interviews — human approval, machine speed."}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={primaryHref}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-base font-semibold text-paper shadow-soft transition-all duration-150 hover:bg-ink/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            {primaryHref === "/outreach" || primaryHref === "/replies" ? (
              <MailCheck className="h-5 w-5" aria-hidden />
            ) : (
              <FilePlus2 className="h-5 w-5" aria-hidden />
            )}
            {primaryLabel}
          </Link>
        </div>

        <p className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted">
          <Sparkles className="h-3.5 w-3.5 text-electric" aria-hidden />
          Every send is a dry-run until you approve it. Nothing leaves without sign-off.
        </p>
      </div>
    </section>
  );
}
