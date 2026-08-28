"use client";

import * as React from "react";
import {
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  Compass,
  Loader2,
  RotateCcw,
  Sparkles,
  Star,
  Upload,
} from "lucide-react";
import { Button, Input, Progress, Select } from "@/components/ui";
import {
  computeChatboxScore,
  deriveStarRating,
  DEFAULT_STAR_THRESHOLDS,
  type ChatboxScoreInputs,
} from "@/lib/tania";
import { DEFAULT_CAREER_SCREENING, type PublicCareerApplicationInput, type PublicCareerJob } from "@/lib/careers";
import { cn, genId } from "@/lib/utils";
import type {
  ChatboxScreeningAnswer,
  ChatboxSubmission,
  StarRating,
} from "@/lib/types";

/* ============================================================================
   Career-website Chatbox — the public candidate entry point (TAnIA §5).
   Fully client-side. Persona "Aria" runs a conversational apply / browse flow,
   scores the applicant and drops a ChatboxSubmission into the recruiter inbox.
   ========================================================================== */

type Sender = "aria" | "candidate";

interface ChatMsg {
  id: string;
  from: Sender;
  text?: string;
  node?: React.ReactNode;
}

interface SayItem {
  text?: string;
  node?: React.ReactNode;
  delay?: number;
}

type Step =
  | "intro"
  | "A_role"
  | "B_desired"
  | "B_sector"
  | "B_city"
  | "B_relocate"
  | "B_visa"
  | "B_matches"
  | "B_nomatch"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "cv"
  | "analyzing"
  | "q1"
  | "q2"
  | "q3"
  | "q4"
  | "q5"
  | "contact"
  | "done";

interface CountryPref {
  name: string;
  dial: string;
  city: string;
  flag: string;
}

const COUNTRIES: CountryPref[] = [
  { name: "France", dial: "+33", city: "Paris", flag: "🇫🇷" },
  { name: "United Kingdom", dial: "+44", city: "London", flag: "🇬🇧" },
  { name: "Germany", dial: "+49", city: "Berlin", flag: "🇩🇪" },
  { name: "Spain", dial: "+34", city: "Madrid", flag: "🇪🇸" },
  { name: "Italy", dial: "+39", city: "Milan", flag: "🇮🇹" },
  { name: "Netherlands", dial: "+31", city: "Amsterdam", flag: "🇳🇱" },
  { name: "United States", dial: "+1", city: "New York", flag: "🇺🇸" },
  { name: "United Arab Emirates", dial: "+971", city: "Dubai", flag: "🇦🇪" },
  { name: "India", dial: "+91", city: "Bengaluru", flag: "🇮🇳" },
  { name: "Singapore", dial: "+65", city: "Singapore", flag: "🇸🇬" },
];

interface Draft {
  path: "A" | "B";
  campaign: PublicCareerJob | null;
  roleTitle: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneCountry: CountryPref;
  phone: string;
  cvFileName?: string;
  detected: ChatboxSubmission["detected"];
  outsideRegion: boolean;
  spontaneous: boolean;
  // Path A screening
  mobility?: "Yes" | "No" | "Relocation required";
  needsVisa?: boolean;
  keyExpStars?: number;
  toolStars?: number;
  projectYes?: boolean;
  // Path B quick-match
  qm: {
    desired?: string;
    sector?: string;
    city?: string;
    relocate?: boolean;
    visaNeeded?: boolean;
  };
  contactTime?: string;
  contactDay?: string;
}

function makeInitialDraft(): Draft {
  return {
    path: "A",
    campaign: null,
    roleTitle: "",
    firstName: "",
    lastName: "",
    email: "",
    phoneCountry: COUNTRIES[0],
    phone: "",
    detected: {},
    outsideRegion: false,
    spontaneous: false,
    qm: {},
  };
}

const STAR_FILLED: Record<StarRating, number> = { TopGun: 5, A: 4, B: 3, C: 2, D: 1 };

const GENERIC_SCREENING = DEFAULT_CAREER_SCREENING;

const SKILL_VOCAB = [
  "React", "TypeScript", "JavaScript", "Python", "Java", "Go", "Rust", "Node.js",
  "AWS", "Azure", "GCP", "Kubernetes", "Docker", "SQL", "GraphQL", "Figma",
  "Product", "Design", "Machine Learning", "Data", "Sales", "Marketing",
  "Salesforce", "Terraform", "Scala", "Kotlin", "Swift", "Leadership", "Agile",
];

const STEP_PROGRESS: Record<Step, number> = {
  intro: 4,
  A_role: 10,
  B_desired: 10,
  B_sector: 16,
  B_city: 22,
  B_relocate: 28,
  B_visa: 34,
  B_matches: 38,
  B_nomatch: 38,
  firstName: 44,
  lastName: 50,
  email: 56,
  phone: 62,
  cv: 68,
  analyzing: 72,
  q1: 76,
  q2: 80,
  q3: 84,
  q4: 88,
  q5: 92,
  contact: 96,
  done: 100,
};

const BACKABLE = new Set<Step>([
  "lastName", "email", "phone", "cv",
  "q1", "q2", "q3", "q4", "q5", "contact",
  "B_sector", "B_city", "B_relocate", "B_visa",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function typingDelay(text?: string): number {
  if (!text) return 420;
  return Math.min(1100, 360 + text.length * 10);
}

function detectSkills(cvText: string, campaign: PublicCareerJob | null, desired?: string): string[] {
  const hay = `${cvText} ${desired ?? ""}`.toLowerCase();
  const found: string[] = [];
  for (const s of SKILL_VOCAB) {
    if (hay.includes(s.toLowerCase())) found.push(s);
    if (found.length >= 5) break;
  }
  if (found.length < 2 && campaign) {
    for (const s of campaign.requiredSkills) {
      if (!found.includes(s)) found.push(s);
      if (found.length >= 4) break;
    }
  }
  if (found.length === 0) return ["Communication", "Stakeholder management"];
  return found.slice(0, 5);
}

function matchCampaigns(d: Draft, open: PublicCareerJob[]): PublicCareerJob[] {
  const terms = [d.qm.desired, d.qm.sector, d.qm.city, ...(d.detected.skills ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tokens = terms.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!tokens.length) return [];
  const scored = open
    .map((c) => {
      const hay = [
        c.title,
        c.department,
        ...c.requiredSkills,
        ...c.niceToHaveSkills,
        ...c.industryExperience,
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score += 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((x) => x.c);
}

function isPublicCareerJob(value: unknown): value is PublicCareerJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const job = value as Partial<PublicCareerJob>;
  return (
    typeof job.id === "string" &&
    typeof job.title === "string" &&
    typeof job.department === "string" &&
    typeof job.seniority === "string" &&
    typeof job.employmentType === "string" &&
    typeof job.locationType === "string" &&
    Array.isArray(job.regions) &&
    Array.isArray(job.requiredSkills) &&
    Array.isArray(job.niceToHaveSkills) &&
    Array.isArray(job.industryExperience) &&
    Array.isArray(job.screeningQuestions)
  );
}

export function Chatbox() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [step, setStep] = React.useState<Step>("intro");
  const [typing, setTyping] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(makeInitialDraft);
  const [jobs, setJobs] = React.useState<PublicCareerJob[]>([]);
  const [careersAvailability, setCareersAvailability] = React.useState<"loading" | "ready" | "unavailable">("loading");
  const [matches, setMatches] = React.useState<PublicCareerJob[]>([]);

  const historyRef = React.useRef<Step[]>([]);
  const cvTextRef = React.useRef<string>("");
  const mounted = React.useRef(true);
  const started = React.useRef(false);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const loadCareers = React.useCallback(async (signal?: AbortSignal) => {
    setCareersAvailability("loading");
    try {
      const response = await fetch("/api/careers", { cache: "no-store", signal });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; jobs?: unknown } | null;
      const publicJobs = Array.isArray(body?.jobs) ? body.jobs.filter(isPublicCareerJob) : [];
      if (!response.ok || body?.ok !== true || publicJobs.length !== (body?.jobs as unknown[] | undefined)?.length) {
        throw new Error("careers unavailable");
      }
      setJobs(publicJobs);
      setCareersAvailability("ready");
    } catch {
      if (!signal?.aborted) {
        setJobs([]);
        setCareersAvailability("unavailable");
      }
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadCareers(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadCareers]);

  const retryCareers = React.useCallback(() => {
    void loadCareers();
  }, [loadCareers]);

  /* ---- message plumbing -------------------------------------------------- */

  const pushUser = React.useCallback((text: string) => {
    setMessages((m) => [...m, { id: genId("msg"), from: "candidate", text }]);
  }, []);

  const say = React.useCallback(async (items: SayItem[]) => {
    for (const it of items) {
      setTyping(true);
      await sleep(it.delay ?? typingDelay(it.text));
      if (!mounted.current) return;
      setTyping(false);
      setMessages((m) => [...m, { id: genId("msg"), from: "aria", text: it.text, node: it.node }]);
      await sleep(140);
      if (!mounted.current) return;
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void say([
        { text: "Hi, I'm Aria. I'll help you apply in just a few minutes.", delay: 350 },
        { text: "Would you like to apply for a specific role, or explore what's open?", delay: 800 },
      ]);
    }
    return () => {
      mounted.current = false;
    };
  }, [say]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing]);

  /* ---- prompts ----------------------------------------------------------- */

  const screeningQ = React.useCallback((i: number, d: Draft): string => {
    const custom = d.campaign?.screeningQuestions;
    return custom?.[i] ?? GENERIC_SCREENING[i];
  }, []);

  const promptFor = React.useCallback(
    (s: Step, d: Draft): SayItem[] => {
      switch (s) {
        case "A_role":
          return [{ text: "Which of these open positions fits you best?" }];
        case "firstName":
          return [{ text: "Let's start with the essentials. What's your first name?" }];
        case "lastName":
          return [{ text: "And your last name?" }];
        case "email":
          return [{ text: "What's the best email to reach you on?" }];
        case "phone":
          return [{ text: "Your phone number? Pick your country code first." }];
        case "cv":
          return [{ text: "Could you share your CV? I'll take a quick look to tailor a few questions." }];
        case "q1":
          return [{ text: screeningQ(0, d) }];
        case "q2":
          return [{ text: screeningQ(1, d) }];
        case "q3":
          return [{ text: screeningQ(2, d) }];
        case "q4":
          return [{ text: screeningQ(3, d) }];
        case "q5":
          return [{ text: screeningQ(4, d) }];
        case "contact":
          return [{ text: "Almost done. When's the best time for our team to reach you?" }];
        case "B_desired":
          return [{ text: "What kind of role are you looking for?" }];
        case "B_sector":
          return [{ text: "Which sector or industry interests you most?" }];
        case "B_city":
          return [{ text: "Where are you based, or where would you like to work?" }];
        case "B_relocate":
          return [{ text: "Would you be open to relocating for the right role?" }];
        case "B_visa":
          return [{ text: "Would you need visa sponsorship to work there?" }];
        default:
          return [];
      }
    },
    [screeningQ],
  );

  /* ---- navigation -------------------------------------------------------- */

  const advance = React.useCallback(
    (next: Step, d: Draft, leadIns: SayItem[] = []) => {
      historyRef.current.push(step);
      setDraft(d);
      setStep(next);
      void say([...leadIns, ...promptFor(next, d)]);
    },
    [step, say, promptFor],
  );

  const startProfile = React.useCallback(
    (d: Draft, leadIns: SayItem[] = []) => {
      historyRef.current.push(step);
      setDraft(d);
      setStep("firstName");
      void say([...leadIns, ...promptFor("firstName", d)]);
    },
    [step, say, promptFor],
  );

  const back = React.useCallback(() => {
    let prev = historyRef.current.pop();
    while (prev && promptFor(prev, draft).length === 0) prev = historyRef.current.pop();
    if (!prev) return;
    setBusy(false);
    setStep(prev);
    void say(promptFor(prev, draft));
  }, [draft, promptFor, say]);

  const resetChat = React.useCallback(() => {
    historyRef.current = [];
    cvTextRef.current = "";
    setMatches([]);
    setDraft(makeInitialDraft());
    setBusy(false);
    setMessages([]);
    setStep("intro");
    void say([
      { text: "Fresh start! Would you like to apply for a specific role, or explore what's open?", delay: 300 },
    ]);
  }, [say]);

  /* ---- CV analysis ------------------------------------------------------- */

  const deriveDetection = React.useCallback(
    (d: Draft): { detected: ChatboxSubmission["detected"]; outsideRegion: boolean } => {
      const country = d.phoneCountry.name;
      const location = `${d.phoneCountry.city}, ${country}`;
      const skills = detectSkills(cvTextRef.current, d.campaign, d.qm.desired);
      const regions = d.campaign?.regions ?? [];
      const outsideRegion =
        regions.length > 0
          ? !regions.some((r) => {
              const rl = r.toLowerCase();
              return (
                rl.includes(country.toLowerCase()) ||
                rl.includes(d.phoneCountry.city.toLowerCase()) ||
                country.toLowerCase().includes(rl)
              );
            })
          : false;
      return {
        detected: { location, nationality: country, phoneCountry: d.phoneCountry.dial, skills },
        outsideRegion,
      };
    },
    [],
  );

  const runAnalysis = React.useCallback(
    async (d: Draft) => {
      historyRef.current.push("cv");
      setDraft(d);
      setStep("analyzing");
      setBusy(true);
      await say([{ text: "Perfect, give me a moment to read through your details.", delay: 350 }]);
      await sleep(850);
      if (!mounted.current) return;
      const det = deriveDetection(d);
      const merged: Draft = { ...d, detected: det.detected, outsideRegion: det.outsideRegion };
      setDraft(merged);
      await say([
        { text: "Done analysing your CV. Here's what I picked up:", delay: 420 },
        { node: <DetectedNode detected={det.detected} />, delay: 260 },
      ]);
      if (!mounted.current) return;
      setBusy(false);
      const next: Step = merged.spontaneous ? "contact" : "q1";
      historyRef.current.push("analyzing");
      setStep(next);
      void say(promptFor(next, merged));
    },
    [say, deriveDetection, promptFor],
  );

  /* ---- submission -------------------------------------------------------- */

  const buildSubmission = React.useCallback(
    (d: Draft): ChatboxSubmission => {
      const inputs: ChatboxScoreInputs = {
        mobility:
          d.mobility ??
          (d.qm.relocate === undefined ? undefined : d.qm.relocate ? "Relocation required" : "No"),
        needsVisa: d.needsVisa ?? d.qm.visaNeeded,
        keyExpStars: d.keyExpStars ?? (d.spontaneous ? 3 : undefined),
        toolStars: d.toolStars ?? (d.spontaneous ? 3 : undefined),
        projectYes: d.projectYes,
        hasContactPref: Boolean(d.contactTime),
        outsideRegion: d.outsideRegion,
      };
      const score = computeChatboxScore(inputs);
      const starRating = deriveStarRating(score.total, DEFAULT_STAR_THRESHOLDS);

      const answers: ChatboxScreeningAnswer[] = [];
      if (d.qm.desired !== undefined) {
        answers.push({ question: "Desired role", answer: d.qm.desired || "—", kind: "quickmatch" });
        answers.push({ question: "Sector", answer: d.qm.sector || "—", kind: "quickmatch" });
        answers.push({ question: "Preferred location", answer: d.qm.city || "—", kind: "quickmatch" });
        answers.push({ question: "Open to relocating", answer: d.qm.relocate ? "Yes" : "No", kind: "quickmatch" });
        answers.push({ question: "Needs visa sponsorship", answer: d.qm.visaNeeded ? "Yes" : "No", kind: "quickmatch" });
      }
      if (!d.spontaneous) {
        answers.push({ question: screeningQ(0, d), answer: d.mobility ?? "—", kind: "mobility" });
        answers.push({ question: screeningQ(1, d), answer: d.needsVisa ? "Yes" : "No", kind: "visa" });
        answers.push({ question: screeningQ(2, d), answer: `${d.keyExpStars ?? 0}/5`, kind: "keyexp", stars: d.keyExpStars });
        answers.push({ question: screeningQ(3, d), answer: `${d.toolStars ?? 0}/5`, kind: "toolexp", stars: d.toolStars });
        answers.push({ question: screeningQ(4, d), answer: d.projectYes ? "Yes" : "No", kind: "project" });
      }

      return {
        id: genId("cbx"),
        path: d.path,
        campaignId: d.campaign?.id ?? null,
        roleTitle: d.roleTitle || d.campaign?.title || "Spontaneous application",
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: `${d.phoneCountry.dial} ${d.phone}`.trim(),
        cvFileName: d.cvFileName,
        detected: d.detected,
        answers,
        score,
        starRating,
        contactPref: d.contactTime ? { time: d.contactTime, day: d.contactDay } : undefined,
        status: "new",
        createdAt: new Date().toISOString(),
      };
    },
    [screeningQ],
  );

  const submitPublicApplication = React.useCallback(async (submission: ChatboxSubmission): Promise<boolean> => {
    const payload: PublicCareerApplicationInput = {
      path: submission.path,
      campaignId: submission.campaignId,
      roleTitle: submission.roleTitle,
      firstName: submission.firstName,
      lastName: submission.lastName,
      email: submission.email,
      phone: submission.phone,
      cvFileName: submission.cvFileName,
      detected: submission.detected,
      answers: submission.answers.map(({ kind, answer, stars, question }) => ({ kind, answer, stars, question })),
      contactPref: submission.contactPref,
    };
    try {
      const response = await fetch("/api/careers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      return response.ok && body?.ok === true;
    } catch {
      return false;
    }
  }, []);

  const finalize = React.useCallback(
    async (d: Draft) => {
      historyRef.current.push(step);
      setDraft(d);
      setStep("done");
      setBusy(true);
      const sub = buildSubmission(d);
      const submitted = await submitPublicApplication(sub);
      if (!submitted) {
        if (!mounted.current) return;
        setBusy(false);
        setStep("contact");
        await say([
          { text: "I couldn't confirm your application just now. Please try again shortly." },
        ]);
        return;
      }
      await say([
        {
          text:
            "Thank you! Your application has been submitted. Our team will review your profile and get back to you soon.",
          delay: 520,
        },
        { node: <ScoreSummary total={sub.score.total} rating={sub.starRating} />, delay: 420 },
        { text: "While you're here, anything else I can help with?", delay: 480 },
      ]);
      if (!mounted.current) return;
      setBusy(false);
    },
    [step, buildSubmission, submitPublicApplication, say],
  );

  /* ---- step handlers ----------------------------------------------------- */

  const chooseA = () => {
    pushUser("Apply for a specific role");
    advance("A_role", { ...draft, path: "A" }, [{ text: "Great, let's find the right role for you." }]);
  };
  const chooseB = () => {
    pushUser("Explore what's open");
    advance("B_desired", { ...draft, path: "B" }, [{ text: "Love the curiosity. Let's find something that fits." }]);
  };

  const selectRole = (c: PublicCareerJob) => {
    pushUser(`Apply for ${c.title}`);
    startProfile({ ...draft, path: "A", campaign: c, roleTitle: c.title, spontaneous: false }, [
      { text: `${c.title}. Excellent choice.` },
    ]);
  };
  const roleToExplore = () => {
    pushUser("I don't see my role, explore instead");
    advance("B_desired", { ...draft, path: "B" });
  };

  const submitFirstName = (v: string) => {
    pushUser(v);
    advance("lastName", { ...draft, firstName: v }, [{ text: `Lovely to meet you, ${v}.` }]);
  };
  const submitLastName = (v: string) => {
    pushUser(v);
    advance("email", { ...draft, lastName: v });
  };
  const submitEmail = (v: string) => {
    pushUser(v);
    advance("phone", { ...draft, email: v });
  };
  const submitPhone = (country: CountryPref, number: string) => {
    pushUser(`${country.flag} ${country.dial} ${number}`);
    advance("cv", { ...draft, phoneCountry: country, phone: number });
  };

  const onCvFile = async (f: File) => {
    try {
      const text = await f.text();
      cvTextRef.current = text.slice(0, 20000);
    } catch {
      cvTextRef.current = "";
    }
    pushUser(`Uploaded ${f.name}`);
    void runAnalysis({ ...draft, cvFileName: f.name });
  };
  const skipCv = () => {
    pushUser("I'll skip the CV for now");
    void runAnalysis(draft);
  };
  const continueCv = () => {
    pushUser("Continue with my CV");
    void runAnalysis(draft);
  };

  const answerQ1 = (v: "Yes" | "No" | "Relocation required") => {
    pushUser(v === "Relocation required" ? "I'd relocate for it" : v);
    advance("q2", { ...draft, mobility: v });
  };
  const answerQ2 = (needsVisa: boolean) => {
    pushUser(needsVisa ? "Yes, I'd need sponsorship" : "No sponsorship needed");
    advance("q3", { ...draft, needsVisa });
  };
  const answerQ3 = (stars: number) => {
    pushUser(`${stars} / 5`);
    advance("q4", { ...draft, keyExpStars: stars });
  };
  const answerQ4 = (stars: number) => {
    pushUser(`${stars} / 5`);
    advance("q5", { ...draft, toolStars: stars });
  };
  const answerQ5 = (yes: boolean) => {
    pushUser(yes ? "Yes" : "No");
    advance("contact", { ...draft, projectYes: yes });
  };

  const submitContact = (time: string, day: string) => {
    const chosenDay = day && day !== "Any day" ? day : undefined;
    pushUser(chosenDay ? `${time}, ${chosenDay}` : `${time}, any day`);
    void finalize({ ...draft, contactTime: time, contactDay: chosenDay });
  };

  const submitBDesired = (v: string) => {
    pushUser(v);
    advance("B_sector", { ...draft, qm: { ...draft.qm, desired: v } });
  };
  const submitBSector = (v: string) => {
    pushUser(v);
    advance("B_city", { ...draft, qm: { ...draft.qm, sector: v } });
  };
  const submitBCity = (v: string) => {
    pushUser(v);
    advance("B_relocate", { ...draft, qm: { ...draft.qm, city: v } });
  };
  const answerBRelocate = (relocate: boolean) => {
    pushUser(relocate ? "Yes, open to relocating" : "No, prefer to stay put");
    advance("B_visa", { ...draft, qm: { ...draft.qm, relocate } });
  };
  const answerBVisa = (visaNeeded: boolean) => {
    pushUser(visaNeeded ? "Yes, I'd need a visa" : "No visa needed");
    const d: Draft = { ...draft, qm: { ...draft.qm, visaNeeded } };
    historyRef.current.push("B_visa");
    setDraft(d);
    const found = matchCampaigns(d, jobs);
    if (found.length) {
      setMatches(found);
      setStep("B_matches");
      void say([
        { text: `Great news, I found ${found.length} role${found.length > 1 ? "s" : ""} that could be a strong fit:` },
      ]);
    } else {
      setStep("B_nomatch");
      void say([
        {
          text:
            "I couldn't find an exact match right now. Want to share your CV so I can take another look, or join our talent pool and we'll reach out when something fits?",
        },
      ]);
    }
  };

  const talentPoolFrom = (d: Draft) => {
    startProfile(
      {
        ...d,
        path: "B",
        spontaneous: true,
        campaign: null,
        roleTitle: d.qm.desired?.trim() || "Spontaneous application",
      },
      [{ text: "Let's get you into our talent community." }],
    );
  };
  const joinTalentPool = () => {
    pushUser("Join the talent pool");
    talentPoolFrom(draft);
  };
  const onNomatchCvFile = async (f: File) => {
    try {
      const text = await f.text();
      cvTextRef.current = text.slice(0, 20000);
    } catch {
      cvTextRef.current = "";
    }
    pushUser(`Uploaded ${f.name}`);
    setBusy(true);
    await sleep(750);
    if (!mounted.current) return;
    const skills = detectSkills(cvTextRef.current, draft.campaign, draft.qm.desired);
    const d: Draft = { ...draft, cvFileName: f.name, detected: { ...draft.detected, skills } };
    const found = matchCampaigns(d, jobs);
    setBusy(false);
    setDraft(d);
    if (found.length) {
      setMatches(found);
      historyRef.current.push("B_nomatch");
      setStep("B_matches");
      void say([
        { text: `Thanks, after reading your CV I found ${found.length} role${found.length > 1 ? "s" : ""} worth a look:` },
      ]);
    } else {
      await say([
        { text: "Still no exact match today, but your profile is worth keeping close. Let me add you to our talent pool.", delay: 500 },
      ]);
      talentPoolFrom(d);
    }
  };

  const doneOption = (label: string, ack: string) => {
    pushUser(label);
    void say([{ text: ack }]);
  };

  /* ---- composer ---------------------------------------------------------- */

  const backable = BACKABLE.has(step) && historyRef.current.length > 0 && !busy && !typing;

  function renderComposer() {
    // Keep the composer inert while Aria is thinking OR still typing the prompt —
    // otherwise a fast answer starts a second, overlapping say() loop and the
    // transcript renders out of order.
    if (busy || typing) {
      return (
        <div className="flex items-center gap-2 py-1 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Aria is thinking…
        </div>
      );
    }
    switch (step) {
      case "intro":
        if (careersAvailability === "loading") {
          return (
            <div className="flex items-center gap-2 py-1 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking available positions…
            </div>
          );
        }
        if (careersAvailability === "unavailable") {
          return (
            <div role="alert" className="rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-muted">
              <p className="font-semibold text-danger">Applications are unavailable right now.</p>
              <p className="mt-1 text-xs">Careers offline. Please retry before treating this as no open roles.</p>
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={retryCareers}>
                Retry loading roles
              </Button>
            </div>
          );
        }
        if (careersAvailability === "ready" && jobs.length === 0) {
          return (
            <div className="rounded-2xl border border-violet/12 bg-surface/70 px-4 py-3 text-sm text-muted">
              No open roles right now, but applications are online. You can join the talent pool instead.
            </div>
          );
        }
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            <BigChoice icon={<Compass className="h-4 w-4" />} title="Apply to a role" hint="I know what I want" onClick={chooseA} />
            <BigChoice icon={<Sparkles className="h-4 w-4" />} title="Explore openings" hint="Show me what fits" onClick={chooseB} />
          </div>
        );
      case "A_role":
        return (
          <div className="space-y-2">
            {jobs.length === 0 ? (
              <p className="text-sm text-muted">No open roles right now, but let's find you a fit.</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {jobs.map((c) => (
                  <RoleCard key={c.id} campaign={c} onSelect={() => selectRole(c)} />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={roleToExplore}
              className="text-xs font-semibold text-electric hover:underline"
            >
              I don't see my role, explore instead
            </button>
          </div>
        );
      case "firstName":
        return <TextComposer key="firstName" placeholder="First name" onSubmit={submitFirstName} />;
      case "lastName":
        return <TextComposer key="lastName" placeholder="Last name" onSubmit={submitLastName} />;
      case "email":
        return (
          <TextComposer
            key="email"
            placeholder="you@email.com"
            type="email"
            validate={(v) => (EMAIL_RE.test(v) ? null : "Please enter a valid email.")}
            onSubmit={submitEmail}
          />
        );
      case "phone":
        return <PhoneComposer initialCountry={draft.phoneCountry} onSubmit={submitPhone} />;
      case "cv":
        return (
          <FileComposer
            onFile={onCvFile}
            existingLabel={draft.cvFileName}
            onContinue={draft.cvFileName ? continueCv : undefined}
            onSkip={skipCv}
          />
        );
      case "q1":
        return (
          <ChoiceRow
            options={[
              { label: "Yes", onClick: () => answerQ1("Yes") },
              { label: "I'd relocate", onClick: () => answerQ1("Relocation required") },
              { label: "No", onClick: () => answerQ1("No") },
            ]}
          />
        );
      case "q2":
        return (
          <ChoiceRow
            options={[
              { label: "No, I'm all set", onClick: () => answerQ2(false) },
              { label: "Yes, I'd need it", onClick: () => answerQ2(true) },
            ]}
          />
        );
      case "q3":
        return <StarComposer key="q3" onPick={answerQ3} />;
      case "q4":
        return <StarComposer key="q4" onPick={answerQ4} />;
      case "q5":
        return (
          <ChoiceRow
            options={[
              { label: "Yes", onClick: () => answerQ5(true) },
              { label: "No", onClick: () => answerQ5(false) },
            ]}
          />
        );
      case "contact":
        return <ContactComposer onSubmit={submitContact} />;
      case "B_desired":
        return (
          <TextComposer
            key="B_desired"
            placeholder="e.g. Frontend Engineer"
            hint="Not sure of the exact title? Describe what you do, e.g. 'building web apps'."
            onSubmit={submitBDesired}
          />
        );
      case "B_sector":
        return <TextComposer key="B_sector" placeholder="e.g. Fintech, Healthcare, Consulting" onSubmit={submitBSector} />;
      case "B_city":
        return <TextComposer key="B_city" placeholder="e.g. Paris, or Remote" onSubmit={submitBCity} />;
      case "B_relocate":
        return (
          <ChoiceRow
            options={[
              { label: "Yes, open to it", onClick: () => answerBRelocate(true) },
              { label: "Prefer to stay", onClick: () => answerBRelocate(false) },
            ]}
          />
        );
      case "B_visa":
        return (
          <ChoiceRow
            options={[
              { label: "No visa needed", onClick: () => answerBVisa(false) },
              { label: "Yes, I'd need one", onClick: () => answerBVisa(true) },
            ]}
          />
        );
      case "B_matches":
        return (
          <div className="space-y-2">
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {matches.map((c) => (
                <RoleCard key={c.id} campaign={c} onSelect={() => selectRole(c)} />
              ))}
            </div>
            <button type="button" onClick={joinTalentPool} className="text-xs font-semibold text-electric hover:underline">
              None of these fit, join the talent pool
            </button>
          </div>
        );
      case "B_nomatch":
        return (
          <div className="space-y-3">
            <FileComposer onFile={onNomatchCvFile} compact />
            <button type="button" onClick={joinTalentPool} className="text-xs font-semibold text-electric hover:underline">
              Skip the CV, just join the talent pool
            </button>
          </div>
        );
      case "done":
        return (
          <div className="flex flex-wrap gap-2">
            <Chip
              onClick={() =>
                doneOption(
                  "Email me a copy",
                  "No email was sent — inbox delivery isn't wired from this chat yet. Your application is saved; a recruiter can follow up from Outreach.",
                )
              }
            >
              Email me a copy
            </Chip>
            <Chip onClick={() => doneOption("Show similar roles", "I'll line up a few similar openings for you.")}>
              Similar opportunities
            </Chip>
            <Chip onClick={() => doneOption("Join the talent pool", "You're in. We'll reach out when something fits.")}>
              Join talent pool
            </Chip>
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={resetChat}>
              Start over
            </Button>
          </div>
        );
      case "analyzing":
        return null;
      default:
        return null;
    }
  }

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-3xl card-surface"
      style={{ height: "min(80vh, 720px)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-violet/10 px-5 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-2xl gradient-purple text-white shadow-glow-purple">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-bold text-ink">
            Aria
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-wide",
                careersAvailability === "unavailable" ? "text-danger" : careersAvailability === "loading" ? "text-muted" : "text-success",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  careersAvailability === "unavailable" ? "bg-danger" : careersAvailability === "loading" ? "bg-muted" : "bg-success status-live",
                )}
                aria-hidden
              />
              {careersAvailability === "unavailable" ? "Careers offline" : careersAvailability === "loading" ? "checking roles" : "careers available"}
            </span>
          </p>
          <p className="truncate text-xs text-muted">Your talent partner at Mantu</p>
        </div>
      </div>

      <Progress
        value={STEP_PROGRESS[step]}
        tone="violet"
        className="rounded-none"
        trackClassName="h-1 rounded-none bg-violet/10"
        aria-label="Application progress"
      />

      {/* Transcript */}
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
      >
        {messages.map((m) => (
          <Bubble key={m.id} from={m.from}>
            {m.node ?? m.text}
          </Bubble>
        ))}
        {typing && <TypingBubble />}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-violet/10 bg-surface/40 px-4 py-4 sm:px-5">
        {backable && (
          <button
            type="button"
            onClick={back}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
          </button>
        )}
        {renderComposer()}
      </div>
    </div>
  );
}

/* ============================================================================
   Presentational sub-components
   ========================================================================== */

function Bubble({ from, children }: { from: Sender; children: React.ReactNode }) {
  const isCandidate = from === "candidate";
  return (
    <div className={cn("flex animate-fade-in", isCandidate ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isCandidate
            ? "gradient-purple rounded-br-md text-white shadow-soft"
            : "rounded-bl-md bg-surface text-ink ring-1 ring-inset ring-violet/10",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-md bg-surface px-4 py-3 ring-1 ring-inset ring-violet/10">
        <span className="dot-typing inline-flex items-center gap-1 text-lg leading-none text-ink/40" aria-label="Aria is typing">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </span>
      </div>
    </div>
  );
}

function BigChoice({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-2xl border border-violet/12 bg-surface/70 px-4 py-3 text-left transition hover:border-electric/50 hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-electric-soft text-electric transition group-hover:bg-electric group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-inset transition",
        active
          ? "gradient-purple text-white ring-transparent shadow-soft"
          : "bg-surface text-ink ring-violet/15 hover:ring-electric/50",
      )}
    >
      {children}
    </button>
  );
}

function ChoiceRow({ options }: { options: { label: string; onClick: () => void }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Chip key={o.label} onClick={o.onClick}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

function TextComposer({
  placeholder,
  type = "text",
  hint,
  validate,
  onSubmit,
}: {
  placeholder: string;
  type?: string;
  hint?: string;
  validate?: (v: string) => string | null;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  function submit() {
    const val = v.trim();
    const e = validate ? validate(val) : val ? null : "This field is required.";
    if (e) {
      setErr(e);
      return;
    }
    onSubmit(val);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Input
          ref={ref}
          type={type}
          value={v}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={Boolean(err)}
          onChange={(e) => {
            setV(e.target.value);
            if (err) setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          size="icon"
          variant="gradient"
          onClick={submit}
          aria-label="Send"
          leftIcon={<ArrowUp className="h-4 w-4" />}
        />
      </div>
      {err ? <p className="text-xs text-danger">{err}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function PhoneComposer({
  initialCountry,
  onSubmit,
}: {
  initialCountry: CountryPref;
  onSubmit: (country: CountryPref, number: string) => void;
}) {
  const startIdx = Math.max(0, COUNTRIES.indexOf(initialCountry));
  const [ci, setCi] = React.useState(String(startIdx));
  const [num, setNum] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const country = COUNTRIES[Number(ci)] ?? COUNTRIES[0];

  function submit() {
    const digits = num.replace(/[^\d]/g, "");
    if (digits.length < 6) {
      setErr("Please enter a valid phone number.");
      return;
    }
    onSubmit(country, num.trim());
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="w-32 shrink-0">
          <Select
            value={ci}
            aria-label="Country code"
            onChange={(e) => setCi(e.target.value)}
            options={COUNTRIES.map((c, i) => ({ value: String(i), label: `${c.flag} ${c.dial}` }))}
          />
        </div>
        <Input
          type="tel"
          inputMode="tel"
          value={num}
          placeholder="Phone number"
          aria-label="Phone number"
          aria-invalid={Boolean(err)}
          onChange={(e) => {
            setNum(e.target.value);
            if (err) setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          size="icon"
          variant="gradient"
          onClick={submit}
          aria-label="Send"
          leftIcon={<ArrowUp className="h-4 w-4" />}
        />
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

function StarComposer({ onPick }: { onPick: (n: number) => void }) {
  const [hover, setHover] = React.useState(0);
  const [val, setVal] = React.useState(0);
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Rate 1 to 5" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= (hover || val);
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={val === n}
              aria-label={`${n} of 5`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              onClick={() => {
                setVal(n);
                onPick(n);
              }}
              className="rounded-full p-1 transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
            >
              <Star
                className={cn("h-8 w-8", on ? "fill-mantu-yellow text-mantu-yellow" : "text-ink/20")}
                fill={on ? "currentColor" : "none"}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted">Tap a star</span>
    </div>
  );
}

const TIMES = ["Morning", "Afternoon", "Evening"];
const DAYS = ["Any day", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function ContactComposer({ onSubmit }: { onSubmit: (time: string, day: string) => void }) {
  const [time, setTime] = React.useState<string | null>(null);
  const [day, setDay] = React.useState("Any day");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TIMES.map((t) => (
          <Chip key={t} active={time === t} onClick={() => setTime(t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="w-40 shrink-0">
          <Select
            value={day}
            aria-label="Preferred day"
            onChange={(e) => setDay(e.target.value)}
            options={DAYS.map((d) => ({ value: d, label: d }))}
          />
        </div>
        <Button
          variant="gradient"
          className="ml-auto"
          disabled={!time}
          onClick={() => time && onSubmit(time, day)}
        >
          Submit application
        </Button>
      </div>
    </div>
  );
}

function FileComposer({
  onFile,
  existingLabel,
  onContinue,
  onSkip,
  compact,
}: {
  onFile: (f: File) => void | Promise<void>;
  existingLabel?: string;
  onContinue?: () => void;
  onSkip?: () => void;
  compact?: boolean;
}) {
  const [reading, setReading] = React.useState(false);
  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setReading(true);
    await onFile(f);
  }
  return (
    <div className="space-y-2">
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-violet/20 bg-surface/60 px-4 text-center transition hover:border-electric/50",
          compact ? "py-4" : "py-6",
        )}
      >
        <input type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.md" className="sr-only" onChange={handle} />
        {reading ? (
          <Loader2 className="h-6 w-6 animate-spin text-electric" aria-hidden />
        ) : (
          <Upload className="h-6 w-6 text-electric" aria-hidden />
        )}
        <span className="text-sm font-semibold text-ink">{reading ? "Reading your CV…" : "Upload your CV"}</span>
        <span className="text-xs text-muted">PDF, Word or text. It stays in your browser.</span>
      </label>
      {(onContinue || onSkip) && (
        <div className="flex items-center justify-between gap-2">
          {onContinue && existingLabel ? (
            <Button variant="ghost" size="sm" onClick={onContinue}>
              Continue with {existingLabel}
            </Button>
          ) : (
            <span />
          )}
          {onSkip && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip for now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RoleCard({ campaign, onSelect }: { campaign: PublicCareerJob; onSelect: () => void }) {
  const meta = [campaign.locationType, campaign.regions[0], campaign.seniority].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex w-full items-start justify-between gap-3 rounded-2xl border border-violet/12 bg-surface/70 p-3.5 text-left transition hover:border-electric/50 hover:shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
    >
      <span className="min-w-0">
        <span className="block text-[0.625rem] font-semibold uppercase tracking-wide text-muted">
          {campaign.department}
        </span>
        <span className="mt-0.5 block truncate font-bold text-ink">{campaign.title}</span>
        {meta && <span className="mt-0.5 block truncate text-xs text-muted">{meta}</span>}
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-electric" aria-hidden />
    </button>
  );
}

function DetectedNode({ detected }: { detected: ChatboxSubmission["detected"] }) {
  return (
    <div className="space-y-2">
      {detected.location && (
        <p className="text-xs">
          <span className="text-muted">Location </span>
          <span className="font-semibold text-ink">{detected.location}</span>
        </p>
      )}
      {detected.skills && detected.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {detected.skills.map((s) => (
            <span key={s} className="rounded-full bg-electric-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-electric">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreSummary({ total, rating }: { total: number; rating: StarRating }) {
  const filled = STAR_FILLED[rating];
  return (
    <div className="rounded-2xl bg-gradient-to-br from-electric-soft to-violet-soft p-3">
      <p className="text-xs font-semibold text-ink">Your profile snapshot</p>
      <div className="mt-1.5 flex items-center gap-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn("h-5 w-5", n <= filled ? "fill-mantu-yellow text-mantu-yellow" : "text-ink/15")}
            fill={n <= filled ? "currentColor" : "none"}
          />
        ))}
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted">Looking strong. Match score {total}/100.</p>
    </div>
  );
}
