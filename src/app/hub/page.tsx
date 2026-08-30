"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";
import { ArrowRight, Sparkles } from "lucide-react";

type HubCard = {
  slug: string;
  title: string;
  summary: string;
  department: string;
  regions: string[];
  requiredSkills: string[];
};

const COPY = {
  fr: {
    eyebrow: "Candidate Hub",
    title: "Postulez. Obtenez votre diagnostic IA. Initiez l'étape suivante.",
    body: "Comme un hub Omogen — sans appels téléphoniques. Aria évalue la compatibilité en asynchrone, puis vous laisse réserver le prochain entretien.",
    cta: "Ouvrir le hub",
    empty: "Catalogue indisponible pour le moment.",
  },
  en: {
    eyebrow: "Candidate Hub",
    title: "Apply. Get your AI diagnostic. Self-start the next step.",
    body: "Omogen-style candidate hubs — without phone calling. Aria scores compatibility asynchronously, then lets you book the next interview.",
    cta: "Open hub",
    empty: "Catalog unavailable right now.",
  },
  es: {
    eyebrow: "Candidate Hub",
    title: "Postúlate. Recibe tu diagnóstico IA. Inicia el siguiente paso.",
    body: "Hubs estilo Omogen — sin llamadas. Aria puntúa compatibilidad en asíncrono y te deja reservar la siguiente entrevista.",
    cta: "Abrir hub",
    empty: "Catálogo no disponible.",
  },
} as const;

export default function HubCatalogPage() {
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  const [hubs, setHubs] = React.useState<HubCard[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/hub/catalog?locale=${locale}`, { credentials: "same-origin" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; hubs?: HubCard[] } | null;
        if (cancelled) return;
        if (!json?.ok || !json.hubs) {
          setError(COPY[locale].empty);
          setHubs([]);
          return;
        }
        setError(null);
        setHubs(json.hubs);
      } catch {
        if (!cancelled) setError(COPY[locale].empty);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const copy = COPY[locale];

  return (
    <HubShell locale={locale} onLocale={setLocale}>
      <section className="relative overflow-hidden pb-10 pt-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="max-w-3xl"
        >
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-electric">{copy.eyebrow}</p>
          <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{copy.body}</p>
        </motion.div>
      </section>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {hubs.map((hub, i) => (
          <motion.li
            key={hub.slug}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.05 }}
          >
            <Link
              href={`/hub/${hub.slug}?locale=${locale}`}
              className="group block h-full rounded-[1.5rem] border border-ink/10 bg-paper/70 p-5 transition hover:border-ink/25 hover:bg-paper"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-muted">
                    {hub.department}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{hub.title}</h2>
                </div>
                <Sparkles className="h-4 w-4 text-electric opacity-70" aria-hidden />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">{hub.summary}</p>
              <p className="mt-3 text-xs text-muted">{hub.regions.join(" · ")}</p>
              <p className="mt-2 text-xs font-medium text-ink/80">{hub.requiredSkills.slice(0, 4).join(" · ")}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                {copy.cta}
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </HubShell>
  );
}
