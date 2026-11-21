import { EXEC_PERIODS, type ExecPeriod } from "@/lib/exec-dashboard";

const PERIODS = new Set<string>(EXEC_PERIODS);

/** Exec overview period. An unknown value keeps the current period. */
export function reduceReportPeriod(current: ExecPeriod, next: string): ExecPeriod {
  return PERIODS.has(next) ? (next as ExecPeriod) : current;
}
