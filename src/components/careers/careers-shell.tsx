"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

/**
 * Light, Mantu-branded wrapper for the public career-site. Deliberately minimal —
 * no recruiter console chrome. Just a wordmark header, the ambient dotted canvas
 * and a small footer.
 */
export function CareersShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-dot-grid">
      <header className="sticky top-0 z-20 border-b border-violet/10 bg-paper/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-2xl gradient-purple text-white shadow-glow-purple">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-base font-extrabold tracking-tight text-ink">
                Aria <span className="font-semibold text-muted">Careers</span>
              </span>
              <span className="mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-muted">
                by Mantu
              </span>
            </span>
          </div>
          <span className="hidden items-center gap-1.5 text-xs font-semibold text-muted sm:inline-flex">
            Applications open when careers is online
          </span>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-violet/10 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted sm:flex-row sm:px-6">
          <p>© Mantu: a conversation-first way to apply.</p>
          <div className="flex items-center gap-4">
            <span className="cursor-default hover:text-ink">Privacy</span>
            <span className="cursor-default hover:text-ink">Cookies</span>
            <span className="cursor-default hover:text-ink">Accessibility</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
