"use client";

import * as React from "react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import {
  FIRST_RUN_GUIDE_STEPS,
  type CommandCenterMode,
  type CommandCenterNextStep,
} from "@/lib/command-center-firstrun";
import { FilePlus2, MailCheck, Sparkles, Zap } from "lucide-react";

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

function HeroDecor({ orbital = false }: { orbital?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
      data-testid="cc-hero-decor"
    >
      <div className="absolute inset-0 bg-dot-grid opacity-50" />
      {orbital ? (
        <div className="orbital absolute -right-24 -top-28 h-80 w-80 rounded-full opacity-30 animate-spin-slow" />
      ) : null}
      <div className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-tangerine/20 blur-3xl" />
      <div className="absolute -bottom-10 right-16 h-56 w-56 rounded-full bg-electric/15 blur-3xl" />
    </div>
  );
}

function FirstRunHero({ nextStep }: { nextStep?: CommandCenterNextStep }) {
  const cta = nextStep?.cta ?? "Paste a job brief";
  const reason =
    nextStep?.reason ??
    "Aria will find people and draft messages — you approve before anything sends.";
  const href = nextStep?.href ?? "/intake";

  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-7 py-12 shadow-soft animate-fade-in sm:px-12 sm:py-16"
      data-testid="cc-hero-first-run"
      aria-labelledby="cc-first-run-title"
    >
      <HeroDecor />

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

        <ol className="mt-10 grid gap-4 sm:grid-cols-3">
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
  const primaryHref = nextStep?.href ?? "/intake";
  const primaryLabel = nextStep?.cta ?? "New intake";
  const showOutreach =
    nextStep?.href !== "/outreach" && nextStep?.href !== "/replies";
  const actingOn = nextStep?.reason?.startsWith("Acting on ")
    ? nextStep.reason.slice("Acting on ".length)
    : null;

  return (
    <section
      className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-7 py-12 shadow-soft animate-fade-in sm:px-12 sm:py-16"
      data-testid="cc-hero-returning"
      aria-labelledby="cc-returning-title"
    >
      <HeroDecor orbital />

      <div className="relative z-10 max-w-3xl">
        <Eyebrow className="text-tangerine">Command Center</Eyebrow>

        <h1 id="cc-returning-title" className="display mt-4 text-4xl text-ink sm:text-5xl lg:text-6xl">
          Your next move is ready.
        </h1>

        {actingOn ? (
          <p
            className="mt-3 inline-flex max-w-full items-center rounded-full bg-violet/[0.08] px-3 py-1 text-sm font-semibold text-ink-soft ring-1 ring-inset ring-violet/15"
            data-testid="cc-acting-on"
          >
            Acting on {actingOn}
          </p>
        ) : null}

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          {actingOn
            ? "Source talent, approve outreach, and book interviews — human approval, machine speed."
            : (nextStep?.reason ??
              "Source talent, approve outreach, and book interviews — human approval, machine speed.")}
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

          {showOutreach && (
            <Link
              href="/outreach"
              className="inline-flex h-12 items-center gap-2 rounded-full border border-ink/15 bg-surface px-7 text-base font-semibold text-ink transition-all duration-150 hover:bg-canvas active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            >
              <MailCheck className="h-5 w-5" aria-hidden />
              Review outreach
            </Link>
          )}

          <span className="inline-flex h-12 items-center gap-1.5 rounded-full bg-tangerine-soft px-4 text-sm font-semibold text-tangerine ring-1 ring-inset ring-tangerine/20">
            <Zap className="h-4 w-4" aria-hidden />
            Always sourcing.
          </span>
        </div>

        <p className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-muted">
          <Sparkles className="h-3.5 w-3.5 text-electric" aria-hidden />
          Every send is a dry-run until you approve it. Nothing leaves without sign-off.
        </p>
      </div>
    </section>
  );
}
