/**
 * Polyline adapted from Polo Sparkline (bidstack-360 chart kit).
 * The path is decorative. The parent KPI exposes the value as text.
 */

export function sparklinePaths(data: readonly number[], width: number, height: number): { line: string; area: string } | null {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - min) / range) * (height - 2) - 1;
    return { x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  if (!last || !first) return null;
  const area = `${line} L ${last.x.toFixed(1)} ${height} L ${first.x.toFixed(1)} ${height} Z`;
  return { line, area };
}

export function Sparkline({ data, tone = "var(--ds-chart-1)" }: { data: readonly number[]; tone?: string }) {
  const width = 96;
  const height = 36;
  const paths = sparklinePaths(data, width, height);
  if (!paths) return null;
  return (
    <svg className="ds-spark" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={paths.area} fill={tone} opacity="0.25" />
      <path d={paths.line} fill="none" stroke={tone} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
