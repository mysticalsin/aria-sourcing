"use client";

import * as React from "react";
import { Modal } from "./modal";
import { Button } from "./button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn>(async () => false);

/**
 * Accessible replacement for `window.confirm()`. Returns a promise that resolves
 * `true` on confirm and `false` on cancel / Escape / backdrop — and unlike the
 * native dialog it is focus-trapped, keyboard-navigable, screen-reader friendly,
 * and renders inside mobile webviews. Use via `const confirm = useConfirm()`.
 */
export function useConfirm(): ConfirmFn {
  return React.useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((v: boolean) => void) | null>(null);

  const confirm = React.useCallback<ConfirmFn>((o) => {
    // If a dialog is already open, resolve the old one as cancelled first.
    resolverRef.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = React.useCallback((v: boolean) => {
    resolverRef.current?.(v);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={opts !== null}
        onClose={() => settle(false)}
        title={opts?.title ?? ""}
        description={opts?.description}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="subtle" size="sm" onClick={() => settle(false)}>
              {opts?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={opts?.danger ? "danger" : "primary"}
              size="sm"
              onClick={() => settle(true)}
            >
              {opts?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        }
      />
    </ConfirmContext.Provider>
  );
}
