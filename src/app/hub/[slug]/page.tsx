"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";
import { Button, Field, Input, useToast } from "@/components/ui";

type HubQuestion = {
  id: string;
  kind: "yesno" | "stars" | "choice" | "text";
  prompt: string;
  choices?: { value: string; label: string }[];
};

type HubDetail = {
  slug: string;
  title: string;
  summary: string;
  regions: string[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  linkedInSearchHint: string;
  questions: HubQuestion[];
  criteria: { id: string; label: string; weight: number }[];
};

function HubRoleInner() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const initialLocale = (search.get("locale") as "fr" | "en" | "es" | null) ?? "fr";
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">(
    initialLocale === "en" || initialLocale === "es" ? initialLocale : "fr",
  );
  const [hub, setHub] = React.useState<HubDetail | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [linkedInUrl, setLinkedInUrl] = React.useState("");
  const [answers, setAnswers] = React.useState<Record<string, { value: string; stars?: number }>>({});

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/hub/${params.slug}?locale=${locale}`, { credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; hub?: HubDetail } | null;
      if (cancelled) return;
      setHub(json?.ok && json.hub ? json.hub : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug, locale]);

  async function submit() {
    if (!hub) return;
    setBusy(true);
    try {
      const payload = {
        locale,
        firstName,
        lastName,
        email,
        phone,
        linkedInUrl: linkedInUrl.trim() || undefined,
        answers: hub.questions.map((q) => {
          const a = answers[q.id];
          return {
            questionId: q.id,
            value: a?.value ?? "",
            stars: a?.stars,
          };
        }),
      };
      const res = await fetch(`/api/hub/${hub.slug}/apply`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        reportUrl?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.reportUrl) {
        toast({
          title: locale === "fr" ? "Candidature incomplète" : "Application incomplete",
          description: json?.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      router.push(json.reportUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubShell locale={locale} onLocale={setLocale}>
      {!hub ? (
        <p className="text-sm text-muted">{locale === "fr" ? "Chargement du hub…" : "Loading hub…"}</p>
      ) : (
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-electric">Candidate Hub</p>
            <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
              {hub.title}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted">{hub.summary}</p>
            <dl className="mt-6 grid gap-3 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Regions</dt>
                <dd className="mt-1 text-ink">{hub.regions.join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Must-have</dt>
                <dd className="mt-1 text-ink">{hub.requiredSkills.join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">Nice-to-have</dt>
                <dd className="mt-1 text-ink">{hub.niceToHaveSkills.join(" · ")}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted">LinkedIn sourcing hint</dt>
                <dd className="mt-1 font-mono text-xs text-ink/80">{hub.linkedInSearchHint}</dd>
              </div>
            </dl>
            <p className="mt-6 rounded-2xl border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-muted">
              Diagnostic IA asynchrone (pas d&apos;appel téléphonique). Les candidats qui passent le
              seuil peuvent initier eux-mêmes l&apos;étape suivante.
            </p>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="rounded-[1.75rem] border border-ink/10 bg-paper/80 p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.02)] sm:p-6"
          >
            <h2 className="text-lg font-semibold text-ink">
              {locale === "fr" ? "Postuler & diagnostic" : "Apply & diagnostic"}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Prénom / First name" htmlFor="fn">
                <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label="Nom / Last name" htmlFor="ln">
                <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="em">
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="ph">
                <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="LinkedIn URL (optional)" htmlFor="li">
                <Input id="li" value={linkedInUrl} onChange={(e) => setLinkedInUrl(e.target.value)} />
              </Field>
            </div>

            <div className="mt-6 space-y-4">
              {hub.questions.map((q) => (
                <div key={q.id} className="rounded-2xl border border-ink/8 bg-ink/[0.02] p-3.5">
                  <p className="text-sm font-medium text-ink">{q.prompt}</p>
                  {q.kind === "stars" ? (
                    <div className="mt-2 flex gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={
                            answers[q.id]?.stars === n
                              ? "h-9 w-9 rounded-full bg-ink text-sm font-bold text-paper"
                              : "h-9 w-9 rounded-full border border-ink/15 text-sm font-semibold text-ink"
                          }
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: { value: String(n), stars: n } }))}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : q.kind === "yesno" ? (
                    <div className="mt-2 flex gap-2">
                      {["yes", "no"].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={
                            answers[q.id]?.value === v
                              ? "rounded-full bg-ink px-3 py-1.5 text-xs font-bold uppercase text-paper"
                              : "rounded-full border border-ink/15 px-3 py-1.5 text-xs font-bold uppercase text-ink"
                          }
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: { value: v } }))}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(q.choices ?? []).map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          className={
                            answers[q.id]?.value === c.value
                              ? "rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper"
                              : "rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink"
                          }
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: { value: c.value } }))}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <Button className="mt-6 w-full" loading={busy} onClick={() => void submit()}>
              {locale === "fr" ? "Obtenir mon diagnostic IA" : "Get my AI diagnostic"}
            </Button>
          </motion.section>
        </div>
      )}
    </HubShell>
  );
}

export default function HubRolePage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-paper" />}>
      <HubRoleInner />
    </React.Suspense>
  );
}
