import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function getSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia(QUERY).matches;
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia(QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
