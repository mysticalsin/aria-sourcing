/**
 * Shared body scroll-lock counter.
 *
 * Multiple overlays (drawer + modal + command palette) can request scroll lock
 * at the same time. The body stays locked until the last one releases it.
 */
let lockCount = 0;
let originalOverflow = "";

export function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount++;
}

export function unlockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (lockCount <= 1) {
    document.body.style.overflow = originalOverflow;
    lockCount = 0;
  } else {
    lockCount--;
  }
}
