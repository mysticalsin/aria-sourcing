"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  GraduationCap,
  ListOrdered,
  Locate,
  Maximize2,
  Minus,
  MousePointerClick,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui";
import { useHermes } from "@/lib/store";
import { supabaseEnabled } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";
import {
  TUTORIAL_CHAPTERS,
  chapterProgress,
  isOnStepRoute,
  nextPosition,
  previousPosition,
  resumePosition,
  stepAt,
  tutorialCounts,
  type TutorialCounts,
  type TutorialPosition,
} from "@/lib/tutorial/curriculum";

/* ============================================================================
   Tutorial mode: a docked panel that walks a newcomer through every part of
   Aria. It never opens by itself; the menu (sidebar, mobile drawer, command
   search) opens it. Progress lives in this browser only (localStorage) and
   never touches the workspace state. The page stays fully usable while the
   panel is open: the highlight is a ring, not a modal backdrop.
   ========================================================================== */

const STORAGE_KEY = "aria:tutorial:v1";

interface TutorialMemory {
  open: boolean;
  view: "contents" | "step";
  position: TutorialPosition;
  completed: string[];
  minimized: boolean;
}

const CLOSED: TutorialMemory = {
  open: false,
  view: "contents",
  position: { chapter: 0, step: 0 },
  completed: [],
  minimized: false,
};

function readMemory(): TutorialMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return CLOSED;
    const parsed = JSON.parse(raw) as Partial<TutorialMemory>;
    const position = parsed.position && stepAt(parsed.position) ? parsed.position : CLOSED.position;
    return {
      open: parsed.open === true,
      view: parsed.view === "step" ? "step" : "contents",
      position,
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((id) => typeof id === "string") : [],
      minimized: parsed.minimized === true,
    };
  } catch {
    return CLOSED;
  }
}

function writeMemory(memory: TutorialMemory) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* private mode: the tutorial still works, it just forgets on reload */
  }
}

interface TutorialContextValue {
  open: boolean;
  openTutorial: () => void;
}

const TutorialContext = React.createContext<TutorialContextValue>({ open: false, openTutorial: () => {} });

export function useTutorial(): TutorialContextValue {
  return React.useContext(TutorialContext);
}

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [memory, setMemory] = React.useState<TutorialMemory>(CLOSED);
  const [loaded, setLoaded] = React.useState(false);
  const focusTitleRef = React.useRef(false);

  React.useEffect(() => {
    setMemory(readMemory());
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    if (loaded) writeMemory(memory);
  }, [memory, loaded]);

  const openTutorial = React.useCallback(() => {
    focusTitleRef.current = true;
    setMemory((m) => ({ ...m, open: true, view: "contents", minimized: false }));
  }, []);

  const goTo = React.useCallback(
    (position: TutorialPosition, markDone?: string) => {
      const step = stepAt(position);
      if (!step) return;
      focusTitleRef.current = true;
      setMemory((m) => ({
        ...m,
        open: true,
        view: "step",
        minimized: false,
        position,
        completed: markDone && !m.completed.includes(markDone) ? [...m.completed, markDone] : m.completed,
      }));
      // Settings steps point at a section through the hash, so a different
      // hash on the same page still needs the navigation.
      const hash = step.route.includes("#") ? `#${step.route.split("#")[1]}` : "";
      const onRoute = isOnStepRoute(step, window.location.pathname, window.location.search);
      if (!onRoute) router.push(step.route);
      // Same page: setting the hash fires the hashchange event Settings listens to.
      else if (hash && window.location.hash !== hash) window.location.hash = hash;
    },
    [router],
  );

  const value = React.useMemo(() => ({ open: memory.open, openTutorial }), [memory.open, openTutorial]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {memory.open && (
        <React.Suspense fallback={null}>
          <TutorialPanel memory={memory} setMemory={setMemory} goTo={goTo} focusTitleRef={focusTitleRef} />
        </React.Suspense>
      )}
    </TutorialContext.Provider>
  );
}

/* ---- Panel ---------------------------------------------------------------- */

function TutorialPanel({
  memory,
  setMemory,
  goTo,
  focusTitleRef,
}: {
  memory: TutorialMemory;
  setMemory: React.Dispatch<React.SetStateAction<TutorialMemory>>;
  goTo: (position: TutorialPosition, markDone?: string) => void;
  focusTitleRef: React.MutableRefObject<boolean>;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const { state, hydrated } = useHermes();
  const completed = React.useMemo(() => new Set(memory.completed), [memory.completed]);
  const step = memory.view === "step" ? stepAt(memory.position) : undefined;
  const chapter = TUTORIAL_CHAPTERS[memory.position.chapter];
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  // Counts when the step opened, so "done" means "done during this step".
  const counts = React.useMemo(() => (hydrated && state ? tutorialCounts(state) : null), [hydrated, state]);
  const startRef = React.useRef<{ id: string; counts: TutorialCounts } | null>(null);
  if (step && counts && startRef.current?.id !== step.id) startRef.current = { id: step.id, counts };
  const exerciseDone = Boolean(step?.done && counts && startRef.current && step.done(counts, startRef.current.counts));
  const isDone = step ? exerciseDone || (Boolean(step.done) && completed.has(step.id)) : false;

  React.useEffect(() => {
    if (step && exerciseDone && !completed.has(step.id)) {
      setMemory((m) => (m.completed.includes(step.id) ? m : { ...m, completed: [...m.completed, step.id] }));
    }
  }, [step, exerciseDone, completed, setMemory]);

  React.useEffect(() => {
    if (!focusTitleRef.current || memory.minimized) return;
    focusTitleRef.current = false;
    titleRef.current?.focus({ preventScroll: true });
  });

  const onRoute = step ? isOnStepRoute(step, pathname, search ? `?${search}` : "") : true;
  const spotlight = useSpotlight(step && onRoute && !memory.minimized ? step.target : undefined, step?.id);
  const dialogOpen = useOpenDialog();
  // A profile drawer or a modal opens on the right: step aside so the form
  // the exercise asks for stays visible.
  const side = dialogOpen || (spotlight.rect && overlapsDefaultCorner(spotlight.rect)) ? "left" : "right";

  // On a phone the panel cannot sit beside the page, so touching the page
  // folds it into the pill and the exercise has the whole screen.
  const panelRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (memory.minimized || memory.view !== "step") return;
    const onPointerDown = (event: PointerEvent) => {
      if (window.innerWidth >= 1024 || panelRef.current?.contains(event.target as Node)) return;
      setMemory((m) => ({ ...m, minimized: true }));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [memory.minimized, memory.view, setMemory]);

  const close = () => setMemory((m) => ({ ...m, open: false }));
  const minimize = () => setMemory((m) => ({ ...m, minimized: true }));
  const showContents = () => {
    focusTitleRef.current = true;
    setMemory((m) => ({ ...m, view: "contents", minimized: false }));
  };
  const resetProgress = () => setMemory((m) => ({ ...m, completed: [], position: { chapter: 0, step: 0 } }));

  const placement = cn(
    "fixed z-[60] print:hidden",
    "inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))]",
    "lg:inset-x-auto lg:bottom-6 lg:w-[24rem]",
    side === "left" ? "lg:left-[calc(260px+1.5rem)]" : "lg:right-6",
  );

  if (memory.minimized) {
    const label = memory.view === "step" ? `Step ${memory.position.chapter + 1}.${memory.position.step + 1}` : "Contents";
    return (
      <>
        {spotlight.overlay}
        <div className={cn(placement, "flex justify-end lg:w-auto")}>
          <button
            type="button"
            onClick={() => {
              focusTitleRef.current = true;
              setMemory((m) => ({ ...m, minimized: false }));
            }}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            <GraduationCap className="h-4 w-4" aria-hidden />
            Tutorial · {label}
            {isDone ? <Check className="h-4 w-4 text-success" aria-label="exercise done" /> : null}
            <Maximize2 className="h-3.5 w-3.5 opacity-70" aria-hidden />
            <span className="sr-only">: show the tutorial</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {spotlight.overlay}
      <section
        ref={panelRef}
        aria-label="Tutorial"
        className={cn(placement, "flex max-h-[46vh] lg:max-h-[min(34rem,calc(100vh-8rem))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-lift")}
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-electric-soft text-electric">
            <GraduationCap className="h-4 w-4" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-muted">
            {memory.view === "step" && chapter
              ? `Chapter ${memory.position.chapter + 1} of ${TUTORIAL_CHAPTERS.length} · ${chapter.title}`
              : "Tutorial"}
          </p>
          {memory.view === "step" && (
            <IconButton label="All chapters" onClick={showContents}>
              <ListOrdered className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label="Minimize the tutorial" onClick={minimize}>
            <Minus className="h-4 w-4" />
          </IconButton>
          <IconButton label="Close the tutorial" onClick={close}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        {memory.view === "contents" || !step ? (
          <Contents
            completed={completed}
            titleRef={titleRef}
            onStart={(position) => goTo(position)}
            onReset={resetProgress}
          />
        ) : (
          <StepView
            stepPosition={memory.position}
            completed={completed}
            isDone={isDone}
            onRoute={onRoute}
            canLocate={Boolean(spotlight.rect)}
            onLocate={spotlight.locate}
            titleRef={titleRef}
            onBack={() => {
              const prev = previousPosition(memory.position);
              if (prev) goTo(prev);
            }}
            onNext={() => {
              const next = nextPosition(memory.position);
              if (next) goTo(next, step.id);
              else {
                setMemory((m) => ({
                  ...m,
                  open: false,
                  view: "contents",
                  completed: m.completed.includes(step.id) ? m.completed : [...m.completed, step.id],
                }));
              }
            }}
            onTakeMeThere={() => goTo(memory.position)}
          />
        )}
      </section>
    </>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-1.5 text-muted transition hover:bg-ink/5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
    >
      {children}
    </button>
  );
}

function Contents({
  completed,
  titleRef,
  onStart,
  onReset,
}: {
  completed: ReadonlySet<string>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onStart: (position: TutorialPosition) => void;
  onReset: () => void;
}) {
  const resume = resumePosition(completed);
  const started = completed.size > 0;
  const totalMinutes = TUTORIAL_CHAPTERS.reduce((sum, c) => sum + c.minutes, 0);
  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <h2 ref={titleRef} tabIndex={-1} className="display text-lg text-ink focus:outline-none">
          Learn Aria step by step
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {TUTORIAL_CHAPTERS.length} short chapters, about {totalMinutes} minutes. Each step shows you where to look and
          gives you one thing to try. You can leave and come back at any time.
        </p>
        <p className="mt-2 rounded-2xl bg-canvas px-3 py-2 text-xs text-muted">
          {supabaseEnabled
            ? "You are in a live workspace: what you create here is real. Nothing is sent without your approval."
            : "Demo data only: the people are fictional and nothing is ever sent."}
        </p>
        <ol className="mt-4 space-y-2">
          {TUTORIAL_CHAPTERS.map((c, index) => {
            const progress = chapterProgress(index, completed);
            const finished = progress.done === progress.total;
            const firstOpen = c.steps.findIndex((s) => !completed.has(s.id));
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onStart({ chapter: index, step: finished ? 0 : Math.max(0, firstOpen) })}
                  className="flex w-full items-start gap-3 rounded-2xl border border-line px-3 py-2.5 text-left transition hover:border-electric/40 hover:bg-electric-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      finished ? "bg-success-soft text-success" : "bg-ink/[0.06] text-ink-soft",
                    )}
                    aria-hidden
                  >
                    {finished ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{c.summary}</span>
                    <span className="mt-1 block text-[0.6875rem] font-semibold text-ink-soft">
                      {progress.done}/{progress.total} steps · about {c.minutes} min
                      {finished ? <span className="sr-only"> · finished</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        {started ? (
          <Button variant="subtle" size="sm" leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={onReset}>
            Start over
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          rightIcon={<ArrowRight className="h-4 w-4" aria-hidden />}
          onClick={() => onStart(resume ?? { chapter: 0, step: 0 })}
        >
          {!started ? "Start the tutorial" : resume ? `Continue: chapter ${resume.chapter + 1}` : "Go through it again"}
        </Button>
      </footer>
    </>
  );
}

function StepView({
  stepPosition,
  completed,
  isDone,
  onRoute,
  canLocate,
  onLocate,
  titleRef,
  onBack,
  onNext,
  onTakeMeThere,
}: {
  stepPosition: TutorialPosition;
  completed: ReadonlySet<string>;
  isDone: boolean;
  onRoute: boolean;
  canLocate: boolean;
  onLocate: () => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onNext: () => void;
  onTakeMeThere: () => void;
}) {
  const chapter = TUTORIAL_CHAPTERS[stepPosition.chapter];
  const step = chapter.steps[stepPosition.step];
  const next = nextPosition(stepPosition);
  const prev = previousPosition(stepPosition);
  const lastOfChapter = stepPosition.step === chapter.steps.length - 1;
  const nextLabel = !next ? "Finish" : lastOfChapter ? "Next chapter" : "Next";

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted">
            Step {stepPosition.step + 1} of {chapter.steps.length}
          </p>
          <ol className="flex gap-1" aria-hidden>
            {chapter.steps.map((s, i) => (
              <li
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === stepPosition.step ? "w-5 bg-electric" : completed.has(s.id) ? "w-1.5 bg-success" : "w-1.5 bg-ink/15",
                )}
              />
            ))}
          </ol>
        </div>

        <h2 ref={titleRef} tabIndex={-1} className="display mt-2 text-lg text-ink focus:outline-none" aria-live="polite">
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>

        {!onRoute && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl border border-tangerine/20 bg-tangerine-soft/60 px-3 py-2">
            <p className="text-xs text-ink-soft">This step happens on {step.page}.</p>
            <Button size="sm" variant="secondary" onClick={onTakeMeThere}>
              Take me there
            </Button>
          </div>
        )}

        {step.tryIt && (
          <div
            className={cn(
              "mt-3 rounded-2xl px-3 py-2.5",
              isDone ? "bg-success-soft" : "bg-electric-soft/60",
            )}
          >
            <p className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", isDone ? "text-success" : "text-electric")}>
              {isDone ? <Check className="h-3.5 w-3.5" aria-hidden /> : <MousePointerClick className="h-3.5 w-3.5" aria-hidden />}
              {isDone ? "Done" : "Try it"}
            </p>
            <p className="mt-1 text-sm text-ink">{isDone && step.doneText ? step.doneText : step.tryIt}</p>
            {step.done && !isDone && (
              <p className="mt-1 text-xs text-muted">The tutorial notices when you have done it. You can also skip ahead.</p>
            )}
            {!isDone && (
              <p className="mt-1 text-xs text-muted lg:hidden">Tap the page to fold this panel; tap the Tutorial button to bring it back.</p>
            )}
            <p className="sr-only" aria-live="polite">
              {isDone ? `Done. ${step.doneText ?? ""}` : ""}
            </p>
          </div>
        )}

        {step.action && (
          <Link
            href={step.action.href}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-electric hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            {step.action.label}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </Link>
        )}

        {onRoute && canLocate && (
          <button
            type="button"
            onClick={onLocate}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
          >
            <Locate className="h-3.5 w-3.5" aria-hidden />
            Show me where
          </button>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <Button
          variant="subtle"
          size="sm"
          leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden />}
          onClick={onBack}
          disabled={!prev}
        >
          Back
        </Button>
        <Button
          size="sm"
          variant={isDone || !step.done ? "primary" : "outline"}
          rightIcon={next ? <ArrowRight className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          onClick={onNext}
        >
          {step.done && !isDone && next ? "Skip" : nextLabel}
        </Button>
      </footer>
    </>
  );
}

/* ---- Spotlight ------------------------------------------------------------ */

function firstVisible(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Rings the step's target and keeps the ring on it while the page scrolls,
 *  resizes or renders late (the target may appear after data loads). */
function useSpotlight(selectors: string[] | undefined, stepId: string | undefined) {
  const [rect, setRect] = React.useState<Box | null>(null);
  const elRef = React.useRef<HTMLElement | null>(null);
  const scrolledFor = React.useRef<string | null>(null);
  const key = selectors?.join("|") ?? "";

  const locate = React.useCallback(() => {
    elRef.current?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  React.useEffect(() => {
    if (!key) {
      elRef.current = null;
      setRect(null);
      return;
    }
    const list = key.split("|");
    const measure = () => {
      const el = firstVisible(list);
      elRef.current = el;
      if (!el) {
        setRect(null);
        return;
      }
      if (scrolledFor.current !== stepId) {
        scrolledFor.current = stepId ?? null;
        const r = el.getBoundingClientRect();
        const behavior = prefersReducedMotion() ? "auto" : "smooth";
        if (window.innerWidth < 1024) {
          // Phone: the panel covers the lower half, so bring the area just
          // under the top bar.
          if (r.top < 120 || r.top > window.innerHeight * 0.4) window.scrollTo({ top: window.scrollY + r.top - 136, behavior });
        } else if (r.top < 64 || r.bottom > window.innerHeight - 120) {
          el.scrollIntoView({ block: "center", behavior });
        }
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    measure();
    const interval = window.setInterval(measure, 500);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [key, stepId]);

  const overlay = rect ? (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[55] rounded-2xl ring-[3px] ring-electric ring-offset-2 ring-offset-paper transition-all duration-200 motion-safe:animate-pulse print:hidden"
      style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
    />
  ) : null;

  return { rect, overlay, locate };
}

/** Whether a modal drawer or dialog is showing (checked twice a second; the
 *  app's dialogs live in many components and share only their ARIA role). */
function useOpenDialog(): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const check = () => setOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    check();
    const interval = window.setInterval(check, 500);
    return () => window.clearInterval(interval);
  }, []);
  return open;
}

/** The panel's default spot (bottom right, desktop). Used to move the panel
 *  to the other side when it would cover the highlighted area. */
function overlapsDefaultCorner(rect: Box): boolean {
  if (typeof window === "undefined" || window.innerWidth < 1024) return false;
  const panel = { left: window.innerWidth - 24 - 384, top: window.innerHeight - 24 - 480 };
  return rect.left + rect.width > panel.left && rect.top + rect.height > panel.top;
}
