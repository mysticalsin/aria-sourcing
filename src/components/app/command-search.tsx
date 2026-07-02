"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/scroll-lock";
import { NAV_ITEMS } from "./nav";
import { useCampaigns, useCandidates, useActions } from "@/lib/store";
import { campaignToAriaContext, parseCommand } from "@/lib/aria-command";
import { AriaCommandConsole } from "@/components/aria/command-console";

interface Result {
  id: string;
  label: string;
  hint: string;
  group: string;
  run: () => void;
}

export function CommandSearch() {
  const router = useRouter();
  const campaigns = useCampaigns();
  const candidates = useCandidates();
  const { setActiveCampaign } = useActions();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [ariaConsoleOpen, setAriaConsoleOpen] = React.useState(false);
  const [ariaConsoleText, setAriaConsoleText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const listboxId = React.useId();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement;
      setQuery("");
      setActive(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      lockBodyScroll();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Tab") trapFocus(e, dialogRef.current);
      };
      document.addEventListener("keydown", onKey);
      return () => {
        window.clearTimeout(t);
        document.removeEventListener("keydown", onKey);
        unlockBodyScroll();
        previouslyFocused.current?.focus?.();
      };
    }
  }, [open]);

  const results = React.useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Result[] = [];
    NAV_ITEMS.forEach((n) => {
      if (!q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
        out.push({ id: `nav-${n.href}`, label: n.label, hint: n.description, group: "Pages", run: () => router.push(n.href) });
    });
    campaigns.forEach((c) => {
      if (!q || c.title.toLowerCase().includes(q) || c.department.toLowerCase().includes(q))
        out.push({
          id: `camp-${c.id}`,
          label: c.title,
          hint: `${c.department} · ${c.status}`,
          group: "Campaigns",
          run: () => {
            setActiveCampaign(c.id);
            router.push(`/campaigns/${c.id}`);
          },
        });
    });
    candidates
      .filter((c) => q && (c.name.toLowerCase().includes(q) || c.currentCompany.toLowerCase().includes(q)))
      .slice(0, 6)
      .forEach((c) =>
        out.push({
          id: `cand-${c.id}`,
          label: c.name,
          hint: `${c.currentTitle} · ${c.currentCompany}`,
          group: "Candidates",
          run: () => router.push(`/candidates?focus=${c.id}`),
        }),
      );

    // Fallback: nothing above matched, but the query reads like an instruction
    // ("source 15 backend engineers…") rather than a search term. Parse it
    // deterministically (same grammar the Aria Command console uses) and, if
    // it resolves into a real plan, surface one result that opens the console
    // pre-parsed instead of leaving the operator with "no matches". A query
    // with no recognizable verb (or gibberish) never reaches this branch —
    // parseCommand returns an empty plan and the normal "no matches" state
    // stands, so ⌘K behavior for ordinary searches is unchanged.
    if (out.length === 0 && q) {
      const plan = parseCommand(query, { campaigns: campaigns.map(campaignToAriaContext) });
      if (plan.steps.length > 0) {
        out.push({
          id: "aria-command-fallback",
          label: `Run with Aria: “${query.trim()}”`,
          hint: plan.summary,
          group: "Aria Command",
          run: () => {
            setAriaConsoleText(query);
            setAriaConsoleOpen(true);
          },
        });
      }
    }

    return out.slice(0, 14);
  }, [query, campaigns, candidates, router, setActiveCampaign]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, Result[]>();
    results.forEach((r) => {
      if (!map.has(r.group)) map.set(r.group, []);
      map.get(r.group)!.push(r);
    });
    return map;
  }, [results]);

  const choose = (r: Result) => {
    r.run();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  let flatIndex = -1;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group flex h-10 w-full max-w-md items-center gap-2.5 rounded-full border border-ink/12 bg-surface px-4 text-sm text-muted transition hover:border-ink/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-electric"
        aria-label="Open command search"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search candidates, campaigns, pages…</span>
        <kbd className="hidden sm:inline-flex items-center rounded-md border border-ink/15 bg-paper px-1.5 py-0.5 text-[0.625rem] font-bold text-muted">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command search"
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-3xl bg-paper shadow-lift animate-scale-in"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-5 w-5 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                aria-label="Search query"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listboxId}
                aria-activedescendant={results[active]?.id}
                className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
              />
            </div>
            <div id={listboxId} role="listbox" aria-label="Search results" className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-muted">No matches for "{query}".</p>
              )}
              {Array.from(grouped.entries()).map(([group, items]) => (
                <div key={group} role="group" aria-label={group} className="mb-1">
                  <p className="eyebrow px-3 py-1.5">{group}</p>
                  {items.map((r) => {
                    flatIndex += 1;
                    const isActive = flatIndex === active;
                    return (
                      <button
                        key={r.id}
                        id={r.id}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => choose(r)}
                        onMouseEnter={() => setActive(results.indexOf(r))}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition",
                          isActive ? "bg-ink text-paper" : "hover:bg-ink/5",
                        )}
                      >
                        {group === "Aria Command" && (
                          <Sparkles className="h-4 w-4 shrink-0 text-electric" aria-hidden />
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-sm font-semibold">{r.label}</span>
                          <span className={cn("block truncate text-xs", isActive ? "text-paper/70" : "text-muted")}>
                            {r.hint}
                          </span>
                        </span>
                        {isActive && <CornerDownLeft className="h-4 w-4 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <AriaCommandConsole open={ariaConsoleOpen} onOpenChange={setAriaConsoleOpen} initialText={ariaConsoleText} />
    </>
  );
}

function trapFocus(e: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
