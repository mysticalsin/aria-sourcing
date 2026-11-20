import { Sparkline } from "../charts/sparkline";
import { Icon } from "../primitives/icon";
import { cx } from "../tokens";

export function formatKpi(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
}

export function KpiCard({
  label,
  value,
  unit,
  deltaPercent,
  period,
  series,
  spark = "var(--ds-chart-1)",
  loading = false,
}: {
  label: string;
  value: number;
  unit?: string;
  deltaPercent?: number;
  period?: string;
  series?: readonly number[];
  spark?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <article className="ds-kpi" role="status" aria-label={`Loading ${label}`}>
        <div className="ds-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </article>
    );
  }
  const sign = deltaPercent === undefined ? 0 : Math.sign(deltaPercent);
  const tone = sign > 0 ? "ds-delta-up" : sign < 0 ? "ds-delta-down" : "ds-delta-flat";
  const word = sign > 0 ? "Up" : sign < 0 ? "Down" : "Flat";
  const icon = sign > 0 ? "up" : sign < 0 ? "down" : "flat";
  const formatted = formatKpi(value);
  return (
    <article className="ds-kpi">
      <p className="ds-kpi-label">{label}</p>
      <div className="ds-kpi-row">
        <div>
          <p className="ds-kpi-value">
            <span aria-label={`${label}: ${formatted}${unit ? ` ${unit}` : ""}`}>{formatted}</span>
            {unit ? <span className="ds-kpi-unit">{unit}</span> : null}
          </p>
          {deltaPercent !== undefined ? (
            <p className={cx("ds-delta", tone)}>
              <Icon name={icon} />
              <span>
                {word} {deltaPercent > 0 ? "+" : ""}
                {deltaPercent.toFixed(1)}% {period}
              </span>
            </p>
          ) : null}
        </div>
        {series && series.length > 1 ? <Sparkline data={series} tone={spark} /> : null}
      </div>
    </article>
  );
}
