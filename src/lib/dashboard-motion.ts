/**
 * Shared Motion / kokonutui-style presets for analytics surfaces.
 * Springs and staggers follow motion.dev defaults; consumers should gate with
 * `usePrefersReducedMotion` and fall back to static markup when reduced.
 */

export const dashboardEase = [0.22, 1, 0.36, 1] as const;

export const dashboardSpring = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 0.8,
};

export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: dashboardEase },
  },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.35, ease: dashboardEase },
  },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: dashboardSpring,
  },
};

export const staggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.04,
    },
  },
};

export const staggerFast = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.035,
      delayChildren: 0.02,
    },
  },
};

/** Parse display strings like "1,234", "42%", "12.5h" into a countable number. */
export function parseMetricNumber(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /^[—–-]$/.test(trimmed) || /not tracked/i.test(trimmed)) return null;
  const match = trimmed.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/** Re-apply the original string's formatting around an animated numeric value. */
export function formatAnimatedMetric(value: string | number, animated: number): string {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? String(Math.round(animated))
      : (Math.round(animated * 10) / 10).toLocaleString();
  }
  const trimmed = value.trim();
  const hasPercent = trimmed.includes("%");
  const hasComma = trimmed.includes(",");
  const suffix = trimmed.match(/[^\d.,%\s-]+$/)?.[0] ?? "";
  const decimals = trimmed.includes(".")
    ? (trimmed.replace(/,/g, "").match(/\.(\d+)/)?.[1]?.length ?? 0)
    : 0;
  let body: string;
  if (decimals > 0) {
    body = animated.toFixed(decimals);
  } else {
    body = String(Math.round(animated));
  }
  if (hasComma) {
    const [intPart, frac] = body.split(".");
    body = `${Number(intPart).toLocaleString()}${frac != null ? `.${frac}` : ""}`;
  }
  return `${body}${hasPercent ? "%" : ""}${suffix && !hasPercent ? suffix : ""}`;
}

/** Period-over-period % change between the last two points (Bklit TrendBadge). */
export function seriesPeriodTrendPercent(series: number[]): number | null {
  if (series.length < 2) return null;
  const previous = series[series.length - 2]!;
  const current = series[series.length - 1]!;
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Cumulative running total — gives sparklines a rising shape from event buckets. */
export function cumulativeSeries(series: number[]): number[] {
  let total = 0;
  return series.map((n) => {
    total += n;
    return total;
  });
}
