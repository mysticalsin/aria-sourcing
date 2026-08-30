"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";

const TIERS = [
  {
    name: "Starter",
    blurb: "Valider Aria sur une famille de rôles (ex. Développeur Java) avec hub + diagnostic.",
    points: ["1–2 hubs actifs", "Diagnostics IA asynchrones", "Next-step self-serve", "Support lancement"],
  },
  {
    name: "Optimize",
    blurb: "Préqualification continue sur les rôles prioritaires + shortlist Mantu.",
    points: [
      "Hubs multi-rôles",
      "Scorecards + outreach empathique",
      "Loop sourcing → entretien",
      "Priority follow-up",
    ],
  },
  {
    name: "Scale",
    blurb: "Multi-sites / volume: gouvernance, API partenaire, reporting scale (200+ diagnostics).",
    points: ["Multi-entity", "API /api/hub", "Règles métier avancées", "Support dédié"],
  },
];

export default function PricingPage() {
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  return (
    <HubShell locale={locale} onLocale={setLocale}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-electric">Pricing</p>
        <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Starter · Optimize · Scale
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Même grille de lecture qu&apos;Omogen: vous payez la préqualification livrée, pas des sièges
          isolés. Les montants se calibrent au volume — contactez Mantu pour un devis.
        </p>
      </motion.div>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {TIERS.map((t, i) => (
          <motion.article
            key={t.name}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i }}
            className="flex flex-col rounded-[1.5rem] border border-ink/10 bg-paper/70 p-5"
          >
            <h2 className="text-xl font-semibold text-ink">{t.name}</h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{t.blurb}</p>
            <ul className="mt-4 space-y-2 text-sm text-ink">
              {t.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </motion.article>
        ))}
      </div>
      <p className="mt-8 text-sm text-muted">
        Pas d&apos;offre voice calling. Pour un devis:{" "}
        <a className="font-semibold text-ink underline-offset-2 hover:underline" href="mailto:twalteur@amaris.com">
          twalteur@amaris.com
        </a>
      </p>
      <Link href="/hub/developpeur-java" className="mt-4 inline-flex text-sm font-semibold text-ink underline-offset-2 hover:underline">
        Essayer le hub Développeur Java →
      </Link>
    </HubShell>
  );
}
