import type { ReactNode } from "react";
import { cx } from "../tokens";

export type BadgeTone = "neutral" | "info" | "pass" | "fail" | "wait";

export function DsBadge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx("ds-badge", `ds-badge-${tone}`)}>{children}</span>;
}
