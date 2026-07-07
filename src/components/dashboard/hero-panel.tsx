"use client";

import * as React from "react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import { FilePlus2, MailCheck, Sparkles, Zap } from "lucide-react";

export function HeroPanel() {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface px-7 py-12 shadow-soft animate-fade-in sm:px-12 sm:py-16">
      {/* Decorative layers — non-interactive, kept behind content */}
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
        <Eyebrow className="text-tangerine">Autonomous recruiting ops</Eyebrow>

        <h1 className="display mt-4 text-4xl text-ink sm:text-5xl lg:text-6xl">
          Autonomous sourcing, delivered beyond.
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Aria turns a single job request into booked interviews: it parses the brief,
          sources matched talent, drafts outreach for your approval, and books the room.
          Human approval, machine speed.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/intake"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-base font-semibold text-paper shadow-soft transition-all duration-150 hover:bg-ink/90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <FilePlus2 className="h-5 w-5" aria-hidden />
            New intake
          </Link>

          <Link
            href="/outreach"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-ink/15 bg-surface px-7 text-base font-semibold text-ink transition-all duration-150 hover:bg-canvas active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <MailCheck className="h-5 w-5" aria-hidden />
            Review outreach
          </Link>

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
