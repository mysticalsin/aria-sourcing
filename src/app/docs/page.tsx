"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";

const LINKS = [
  { href: "/docs/api", title: "API reference", body: "REST publique Candidate Hub (/api/hub/*)." },
  { href: "/hub", title: "Candidate hubs", body: "Parcours candidat: apply → diagnostic → next step." },
  { href: "/product", title: "ADN produit", body: "Positionnement Aria vs Omogen (sans calling)." },
  { href: "/pricing", title: "Pricing", body: "Starter / Optimize / Scale." },
];

export default function DocsPage() {
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  return (
    <HubShell locale={locale} onLocale={setLocale}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-electric">Documentation</p>
        <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink">
          Get started with Aria
        </h1>
        <p className="mt-4 text-base text-muted">
          Tout pour intégrer le Candidate Hub et le diagnostic IA dans votre funnel — sans agent vocal.
        </p>
      </motion.div>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2">
        {["Créer / publier un hub", "Partager le lien LinkedIn", "Recevoir diagnostics + next-steps", "Brancher l'API"].map(
          (step, i) => (
            <li key={step} className="rounded-2xl border border-ink/10 bg-paper/70 px-4 py-3 text-sm text-ink">
              <span className="text-xs font-bold text-muted">0{i + 1}</span>
              <p className="mt-1 font-semibold">{step}</p>
            </li>
          ),
        )}
      </ol>
      <div className="mt-8 grid gap-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-[1.25rem] border border-ink/10 bg-paper/70 px-4 py-4 hover:border-ink/25"
          >
            <p className="font-semibold text-ink">{l.title}</p>
            <p className="mt-1 text-sm text-muted">{l.body}</p>
          </Link>
        ))}
      </div>
    </HubShell>
  );
}
