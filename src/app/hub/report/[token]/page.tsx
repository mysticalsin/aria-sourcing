"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { HubShell } from "@/components/hub/hub-shell";
import { Button, Field, Input, useToast } from "@/components/ui";

type Report = {
  reportId: string;
  roleTitle: string;
  candidateName: string;
  total: number;
  recommendation: string;
  starRating: string;
  criteria: { id: string; label: string; weight: number; score: number; detail: string }[];
  nextStepUnlocked: boolean;
  nextStepStatus: string;
  nextStep?: { day?: string; time?: string; note?: string };
  screeningMode: string;
};

export default function HubReportPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [locale, setLocale] = React.useState<"fr" | "en" | "es">("fr");
  const [report, setReport] = React.useState<Report | null>(null);
  const [token, setToken] = React.useState(params.token);
  const [day, setDay] = React.useState("Mardi");
  const [time, setTime] = React.useState("10:00");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/hub/report/${encodeURIComponent(params.token)}`, {
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; report?: Report } | null;
      if (cancelled) return;
      if (json?.ok && json.report) {
        setReport(json.report);
        setToken(params.token);
      } else {
        setReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  async function requestNextStep() {
    setBusy(true);
    try {
      const res = await fetch(`/api/hub/report/${encodeURIComponent(token)}/next-step`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, time, note: note || undefined }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        report?: Report;
        token?: string;
        reportUrl?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.report || !json.token) {
        toast({
          title: "Next step unavailable",
          description: json?.error ?? `HTTP ${res.status}`,
          variant: "error",
        });
        return;
      }
      setReport(json.report);
      setToken(json.token);
      if (json.reportUrl) router.replace(json.reportUrl);
      toast({
        title: locale === "fr" ? "Étape suivante demandée" : "Next step requested",
        description:
          locale === "fr"
            ? "Un recruteur confirmera le créneau. Aucun appel automatique."
            : "A recruiter will confirm the slot. No automated calling.",
        variant: "success",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <HubShell locale={locale} onLocale={setLocale}>
      {!report ? (
        <p className="text-sm text-muted">
          {locale === "fr" ? "Rapport introuvable ou expiré." : "Report missing or expired."}
        </p>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-electric">
              Diagnostic de compatibilité IA
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display,ui-serif)] text-4xl font-semibold tracking-tight text-ink">
              {report.candidateName}
            </h1>
            <p className="mt-2 text-muted">
              {report.roleTitle} · {report.starRating} · {report.recommendation.replace("_", " ")}
            </p>
            <div className="mt-6 flex items-end gap-3">
              <span className="font-[family-name:var(--font-display,ui-serif)] text-6xl font-semibold text-ink">
                {report.total}
              </span>
              <span className="pb-2 text-sm font-semibold text-muted">/ 100</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              Mode: {report.screeningMode} · appels téléphoniques exclus
            </p>
            <ul className="mt-8 space-y-3">
              {report.criteria.map((c) => (
                <li key={c.id} className="rounded-2xl border border-ink/10 bg-paper/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-ink">{c.label}</p>
                    <p className="text-sm font-bold text-ink">
                      {c.score}
                      <span className="font-medium text-muted">/{c.weight}</span>
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
                    <div
                      className="h-full rounded-full bg-electric"
                      style={{ width: `${Math.max(4, (c.score / Math.max(1, c.weight)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">{c.detail}</p>
                </li>
              ))}
            </ul>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="rounded-[1.75rem] border border-ink/10 bg-paper/80 p-5 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-ink">
              {locale === "fr" ? "Étape suivante" : "Next step"}
            </h2>
            {!report.nextStepUnlocked ? (
              <p className="mt-3 text-sm text-muted">
                Score insuffisant pour auto-initier l&apos;entretien. Un recruteur peut tout de même
                vous recontacter.
              </p>
            ) : report.nextStepStatus === "requested" ? (
              <div className="mt-4 rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">
                <p className="font-semibold">Créneau demandé</p>
                <p className="mt-1">
                  {report.nextStep?.day} · {report.nextStep?.time}
                  {report.nextStep?.note ? ` — ${report.nextStep.note}` : ""}
                </p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  Initiez vous-même le prochain entretien. Aria notifie le recruteur — aucun appel
                  automatique.
                </p>
                <div className="mt-4 grid gap-3">
                  <Field label="Jour / Day" htmlFor="day">
                    <Input id="day" value={day} onChange={(e) => setDay(e.target.value)} />
                  </Field>
                  <Field label="Heure / Time" htmlFor="time">
                    <Input id="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </Field>
                  <Field label="Note" htmlFor="note">
                    <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>
                <Button className="mt-5 w-full" loading={busy} onClick={() => void requestNextStep()}>
                  {locale === "fr" ? "Initier l'entretien" : "Start next interview step"}
                </Button>
              </>
            )}
          </motion.section>
        </div>
      )}
    </HubShell>
  );
}
