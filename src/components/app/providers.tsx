"use client";

import * as React from "react";
import { HermesProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HermesProvider>
      <ToastProvider>{children}</ToastProvider>
    </HermesProvider>
  );
}
