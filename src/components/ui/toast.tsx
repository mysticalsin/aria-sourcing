"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  href?: string;
  actionLabel?: string;
};

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  href?: string;
  actionLabel?: string;
}

interface ToastContextValue {
  toast: (t: ToastInput) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-success" />,
  error: <XCircle className="h-5 w-5 text-danger" />,
  info: <Info className="h-5 w-5 text-electric" />,
  warning: <AlertTriangle className="h-5 w-5 text-warning" />,
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const remove = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: ToastInput) => {
      counter += 1;
      const id = counter;
      const next: Toast = {
        id,
        title: t.title,
        description: t.description,
        variant: t.variant ?? "info",
        href: t.href,
        actionLabel: t.actionLabel,
      };
      setToasts((prev) => [...prev, next]);
      window.setTimeout(() => remove(id), t.href ? 10_000 : 4600);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            aria-live={t.variant === "error" ? "assertive" : "polite"}
            data-testid={t.variant === "error" ? "toast-error" : "toast"}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lift animate-fade-in",
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.variant]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
              {t.href && t.actionLabel ? (
                <Link
                  data-testid="toast-cta"
                  href={t.href}
                  className="mt-2 inline-flex h-8 items-center rounded-full bg-ink px-3 text-xs font-semibold text-paper"
                >
                  {t.actionLabel}
                </Link>
              ) : null}
            </div>
            <button
              onClick={() => remove(t.id)}
              aria-label="Dismiss notification"
              className="rounded-full p-1 text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) return { toast: () => undefined };
  return ctx;
}
