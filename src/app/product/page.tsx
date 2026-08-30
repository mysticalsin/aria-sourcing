"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";

const SECTIONS = [
  {
    title: "ADN produit",
    body: "Aria orchestre le loop Mantu de bout en bout: besoin Outlook → sourcing → shortlist → outreach empathique → validation multi-agents → entretien. Contrairement à Omogen/Mio, Aria ne téléphone pas les candidats: le diagnostic est asynchrone et le candidat initie l'étape suivante.",
  },
  {
    title: "Candidate Hub",
    body: "Chaque poste (ex. Développeur Java) a un hub public partageable sur LinkedIn. Le candidat postule, reçoit un diagnostic de compatibilité IA, puis réserve lui-même le prochain entretien.",
  },
  {
    title: "Diagnostic IA (scale)",
    body: "Scorecard pondérée par critère (mobilité, droit au travail, expérience, skills, langues, dispo). Conçu pour monter à l'échelle de centaines de rapports / campagne — sans call center vocal.",
  },
  {
    title: "API & docs",
    body: "Surface publique /api/hub/* documentée pour intégrer hubs, candidatures, rapports et next-step dans un ATS ou un site carrière.",
  },
];

export default function ProductPage() {
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  return (
    <HubShell locale={locale} onLocale={setLocale}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-electric">Produit · FR</p>
        <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Aria vs Omogen — même ambition, sans appeler
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Deck commercial synthétique (FR; EN/ES via le sélecteur). Objectif: rivaliser sur hub
          candidat, diagnostic, API et pricing — hors voice calling.
        </p>
      </motion.div>
      <div className="mt-10 grid gap-4">
        {SECTIONS.map((s, i) => (
          <motion.article
            key={s.title}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i }}
            className="rounded-[1.5rem] border border-ink/10 bg-paper/70 p-5"
          >
            <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
          </motion.article>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/hub/developpeur-java"
          className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper"
        >
          Hub Développeur Java
        </Link>
        <Link
          href="/pricing"
          className="inline-flex h-11 items-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink"
        >
          Pricing
        </Link>
        <Link
          href="/docs/api"
          className="inline-flex h-11 items-center rounded-full border border-ink/15 px-5 text-sm font-semibold text-ink"
        >
          API docs
        </Link>
      </div>
    </HubShell>
  );
}
