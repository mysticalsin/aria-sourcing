"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { HermesProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Public/auth pages must not fetch or hydrate a tenant workspace. Besides
  // avoiding a needless authenticated request, this keeps recipient-facing
  // unsubscribe links independent from console state.
  const barePath = pathname.startsWith("/login") || pathname.startsWith("/careers") || pathname.startsWith("/unsubscribe");
  // No global MotionConfig: it would put the animation library in every page's bundle.
  // The few animated components read usePrefersReducedMotion themselves.
  const content = <ToastProvider>{children}</ToastProvider>;
  return barePath ? content : <HermesProvider>{content}</HermesProvider>;
}
