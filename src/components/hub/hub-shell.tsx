"use client";

import * as React from "react";
import Link from "next/link";

/**
 * Public candidate-hub chrome — brand-first, no recruiter console.
 * Avoids purple-on-white AI-slop; uses ink / paper / electric from Aria tokens.
 */
export function HubShell({
  children,
  locale = "fr",
  onLocale,
}: {
  children: React.ReactNode;
  locale?: "fr" | "en" | "es";
  onLocale?: (locale: "fr" | "en" | "es") => void;
}) {
  return (
    <div className="relative min-h-screen bg-[radial-gradient(1200px_600px_at_10%_-10%,hsl(210_80%_96%),transparent),radial-gradient(900px_500px_at_90%_0%,hsl(28_90%_95%),transparent)] bg-paper">
      <header className="sticky top-0 z-20 border-b border-ink/10 bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/hub" className="group flex min-w-0 flex-col">
            <span className="font-[family-name:var(--font-display,ui-serif)] text-2xl font-semibold tracking-tight text-ink">
              Aria
            </span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted">
              Candidate Hub · Mantu
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {(["fr", "en", "es"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onLocale?.(code)}
                className={
                  locale === code
                    ? "rounded-full bg-ink px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-paper"
                    : "rounded-full px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wider text-muted hover:text-ink"
                }
              >
                {code}
              </button>
            ))}
            <Link
              href="/product"
              className="hidden text-xs font-semibold text-muted hover:text-ink sm:inline"
            >
              Produit
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t border-ink/10 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Screening asynchrone · pas d&apos;appels téléphoniques automatisés.</p>
          <div className="flex gap-4">
            <Link href="/docs" className="hover:text-ink">
              Docs
            </Link>
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/careers" className="hover:text-ink">
              Careers chat
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
