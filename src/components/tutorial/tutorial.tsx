"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { isOnStepRoute, stepAt, type TutorialPosition } from "@/lib/tutorial/curriculum";
import type { TutorialMemory } from "./tutorial-panel";

/* ============================================================================
   Tutorial mode: a docked panel that walks a newcomer through every part of
   Aria. It never opens by itself; the menu (sidebar, mobile drawer, command
   search) opens it. Progress lives in this browser only (localStorage) and
   never touches the workspace state. The page stays fully usable while the
   panel is open: the highlight is a ring, not a modal backdrop.
   ========================================================================== */

const STORAGE_KEY = "aria:tutorial:v1";


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

// The panel (and its curriculum UI) is its own chunk: pages only pay for it
// once someone opens the tutorial.
const TutorialPanel = dynamic(() => import("./tutorial-panel").then((mod) => mod.TutorialPanel), { ssr: false });

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
