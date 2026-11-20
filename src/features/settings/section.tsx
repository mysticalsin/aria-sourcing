"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Eyebrow, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  SETTINGS_N_TO_TAB,
  settingsHeaderId,
  settingsNeighborSection,
  settingsPanelId,
  settingsSectionId,
  settingsSectionsForTab,
} from "@/lib/settings-accordion";

export const SettingsTabContext = React.createContext("integrations");

export type SettingsAccordionContextValue = {
  openSection: string | null;
  setOpenSection: (section: string) => void;
  focusSectionHeader: (section: string) => void;
};

export const SettingsAccordionContext = React.createContext<SettingsAccordionContextValue>({
  openSection: null,
  setOpenSection: () => {},
  focusSectionHeader: () => {},
});

export function SettingsSection({
  n,
  eyebrow,
  title,
  description,
  children,
}: {
  n: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const activeTab = React.useContext(SettingsTabContext);
  const { openSection, setOpenSection, focusSectionHeader } = React.useContext(SettingsAccordionContext);
  if (SETTINGS_N_TO_TAB[n] && SETTINGS_N_TO_TAB[n] !== activeTab) return null;

  const siblings = settingsSectionsForTab(activeTab);
  const isSolo = siblings.length <= 1;
  const isOpen = isSolo || openSection === n;
  const panelId = settingsPanelId(n);
  const headerId = settingsHeaderId(n);

  const onAccordionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let direction: "next" | "prev" | "first" | "last" | null = null;
    if (event.key === "ArrowDown") direction = "next";
    else if (event.key === "ArrowUp") direction = "prev";
    else if (event.key === "Home") direction = "first";
    else if (event.key === "End") direction = "last";
    if (!direction) return;
    event.preventDefault();
    const target = settingsNeighborSection(activeTab, n, direction);
    if (!target) return;
    setOpenSection(target);
    focusSectionHeader(target);
  };

  if (isSolo) {
    return (
      <section
        id={settingsSectionId(n)}
        className="scroll-mt-20 border-t border-line py-4 first:border-t-0 first:pt-0"
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="display text-lg text-ink sm:text-xl">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
          </div>
        </div>
        <div className="space-y-3">{children}</div>
      </section>
    );
  }

  return (
    <section id={settingsSectionId(n)} className="scroll-mt-20 border-t border-line first:border-t-0">
      <h2 className="m-0">
        <button
          type="button"
          id={headerId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setOpenSection(n)}
          onKeyDown={onAccordionKeyDown}
          className={cn(
            "flex w-full items-center gap-3 py-2.5 text-left transition-colors",
            "hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric",
            isOpen ? "bg-ink/[0.02]" : "",
          )}
        >
          <div className="min-w-0 flex-1">
            <Eyebrow>{eyebrow}</Eyebrow>
            <span className="display block text-base text-ink sm:text-lg">{title}</span>
            <span
              className={cn("mt-0.5 line-clamp-1 block text-xs text-muted", isOpen && "invisible")}
              aria-hidden={isOpen}
            >
              {description}
            </span>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted transition-transform duration-150",
              isOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </h2>
      <SettingsAccordionPanel id={panelId} headerId={headerId} isOpen={isOpen}>
        <p className="text-sm text-muted">{description}</p>
        {children}
      </SettingsAccordionPanel>
    </section>
  );
}

function SettingsAccordionPanel({
  id,
  headerId,
  isOpen,
  children,
}: {
  id: string;
  headerId: string;
  isOpen: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(isOpen);
  React.useEffect(() => {
    if (isOpen) setMounted(true);
  }, [isOpen]);
  return (
    <div id={id} role="region" aria-labelledby={headerId} hidden={!isOpen} className="space-y-3 pb-4 pt-1">
      {mounted ? children : null}
    </div>
  );
}

export function SettingsToggleRow({
  id,
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink/[0.06] text-ink-soft"
            aria-hidden
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-semibold text-ink">
            {label}
          </label>
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        </div>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} label={label} disabled={disabled} />
    </div>
  );
}
