"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/hub/catalog?locale=fr",
    desc: "Liste des hubs publics (titres, critères, questions).",
  },
  {
    method: "GET",
    path: "/api/hub/{slug}?locale=fr",
    desc: "Détail d'un hub (ex. developpeur-java).",
  },
  {
    method: "POST",
    path: "/api/hub/{slug}/apply",
    desc: "Candidature + diagnostic. Réponse: report + token signé + reportUrl.",
  },
  {
    method: "GET",
    path: "/api/hub/report/{token}",
    desc: "Lire le diagnostic de compatibilité IA.",
  },
  {
    method: "POST",
    path: "/api/hub/report/{token}/next-step",
    desc: "Le candidat initie l'étape suivante (jour/heure). Pas d'appel téléphonique.",
  },
];

export default function DocsApiPage() {
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  return (
    <HubShell locale={locale} onLocale={setLocale}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-electric">API</p>
        <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink">
          Candidate Hub API
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted">
          Surface publique rate-limitée. Les rapports sont signés (DATA_ENCRYPTION_KEY /
          CANDIDATE_HUB_SECRET). callingExcluded=true sur toutes les réponses.
        </p>
      </motion.div>
      <ul className="mt-8 space-y-3">
        {ENDPOINTS.map((e) => (
          <li key={e.path} className="rounded-[1.25rem] border border-ink/10 bg-paper/70 px-4 py-4">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-electric">{e.method}</p>
            <p className="mt-1 font-mono text-sm text-ink">{e.path}</p>
            <p className="mt-2 text-sm text-muted">{e.desc}</p>
          </li>
        ))}
      </ul>
      <pre className="mt-8 overflow-x-auto rounded-[1.25rem] border border-ink/10 bg-ink px-4 py-4 text-xs leading-relaxed text-paper">
{`curl -sS 'https://aria-mantu-app.fly.dev/api/hub/catalog?locale=fr' | jq
curl -sS 'https://aria-mantu-app.fly.dev/api/hub/developpeur-java?locale=fr' | jq`}
      </pre>
    </HubShell>
  );
}
