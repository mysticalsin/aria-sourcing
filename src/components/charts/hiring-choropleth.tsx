"use client";

import * as React from "react";
import { Mercator } from "@visx/geo";
import { localPoint } from "@visx/event";
import { ParentSize } from "@visx/responsive";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { motion } from "framer-motion";
import { geoMercator } from "d3-geo";
import topology from "world-atlas/countries-110m.json";
import {
  choroplethFill,
  type CountryHiringStat,
  type HiringGeographyModel,
} from "@/lib/hiring-geography";
import { fadeUp } from "@/lib/dashboard-motion";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";

type CountryFeature = Feature<Geometry, { name: string }> & { id?: string | number };

const world = feature(
  topology as unknown as Topology,
  (topology as { objects: { countries: unknown } }).objects.countries as never,
) as unknown as FeatureCollection<Geometry, { name: string }>;

/** Fit Mercator so every country is inside the SVG viewport (with padding). */
const MAP_PADDING = 10;

function worldMercatorFit(
  width: number,
  height: number,
): { scale: number; translate: [number, number] } {
  const projection = geoMercator().fitExtent(
    [
      [MAP_PADDING, MAP_PADDING],
      [Math.max(MAP_PADDING + 1, width - MAP_PADDING), Math.max(MAP_PADDING + 1, height - MAP_PADDING)],
    ],
    world,
  );
  const translate = projection.translate();
  return {
    scale: projection.scale() ?? width / 6,
    translate: [translate[0] ?? width / 2, translate[1] ?? height / 2],
  };
}

interface TooltipState {
  x: number;
  y: number;
  name: string;
  sourced: number;
  avgMatchScore: number;
  contacted: number;
  booked: number;
}

function MapSvg({
  width,
  height,
  model,
}: {
  width: number;
  height: number;
  model: HiringGeographyModel;
}) {
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null);
  const statsByNumeric = React.useMemo(() => {
    const map = new Map<string, CountryHiringStat>();
    for (const row of model.byCountry) map.set(row.numericId, row);
    return map;
  }, [model.byCountry]);

  const { scale, translate } = React.useMemo(
    () => worldMercatorFit(width, height),
    [width, height],
  );

  if (width < 10 || height < 10) return null;

  return (
    <div className="relative h-full w-full">
      <svg width={width} height={height} role="img" aria-label="Hiring geography choropleth">
        <rect width={width} height={height} fill="hsl(var(--paper) / 0.4)" rx={12} />
        <Mercator<CountryFeature>
          data={world.features as CountryFeature[]}
          scale={scale}
          translate={translate}
        >
          {(mercator) => (
            <g>
              {/* light graticule-ish frame */}
              <path
                d={mercator.path({ type: "Sphere" }) ?? undefined}
                fill="hsl(var(--surface))"
                stroke="hsl(var(--line))"
                strokeWidth={0.75}
              />
              {mercator.features.map(({ feature: f, path }, i) => {
                if (!path) return null;
                const id = String(f.id ?? "");
                const count = model.countByNumericId[id] ?? 0;
                const active = hoverId === id;
                const faded = hoverId != null && !active;
                const fill = choroplethFill(count, model.maxCount);
                const stat = statsByNumeric.get(id);
                return (
                  <path
                    key={`country-${id || i}`}
                    d={path}
                    fill={fill}
                    stroke="hsl(var(--line))"
                    strokeWidth={active ? 1.1 : 0.4}
                    opacity={faded ? 0.4 : 1}
                    className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                    onMouseEnter={(event) => {
                      setHoverId(id);
                      const point = localPoint(event);
                      setTooltip({
                        x: point?.x ?? 0,
                        y: point?.y ?? 0,
                        name: f.properties?.name ?? "Unknown",
                        sourced: count,
                        avgMatchScore: stat?.avgMatchScore ?? 0,
                        contacted: stat?.contacted ?? 0,
                        booked: stat?.booked ?? 0,
                      });
                    }}
                    onMouseMove={(event) => {
                      const point = localPoint(event);
                      setTooltip((prev) =>
                        prev && point
                          ? { ...prev, x: point.x, y: point.y }
                          : prev,
                      );
                    }}
                    onMouseLeave={() => {
                      setHoverId(null);
                      setTooltip(null);
                    }}
                  />
                );
              })}
            </g>
          )}
        </Mercator>
      </svg>

      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-md bg-ink px-3 py-2 text-xs text-paper shadow-lg"
          style={{
            left: Math.min(tooltip.x + 12, width - 180),
            top: Math.max(8, tooltip.y - 12),
          }}
        >
          <p className="font-semibold">{tooltip.name}</p>
          <p className="mt-1 tabular-nums text-paper/85">
            Sourced <span className="font-bold text-paper">{formatNumber(tooltip.sourced)}</span>
          </p>
          {tooltip.sourced > 0 ? (
            <p className="mt-0.5 tabular-nums text-paper/70">
              Avg match {formatNumber(tooltip.avgMatchScore)} · Contacted{" "}
              {formatNumber(tooltip.contacted)} · Booked {formatNumber(tooltip.booked)}
            </p>
          ) : (
            <p className="mt-0.5 text-paper/60">No candidates sourced here yet</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Legend({ maxCount }: { maxCount: number }) {
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    fill: choroplethFill(t === 0 ? 0 : Math.max(1, Math.round(t * maxCount)), Math.max(maxCount, 1)),
    label: t === 0 ? "0" : String(Math.max(1, Math.round(t * maxCount))),
  }));
  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-muted">
      <span className="font-semibold uppercase tracking-[0.08em]">Sourced</span>
      {stops.map((stop) => (
        <span key={stop.t} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-4 rounded-sm ring-1 ring-line/60" style={{ background: stop.fill }} />
          {stop.label}
        </span>
      ))}
    </div>
  );
}

export function HiringChoropleth({
  model,
  className,
  height = 360,
}: {
  model: HiringGeographyModel;
  className?: string;
  height?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <motion.div
      variants={fadeUp}
      initial={reducedMotion ? false : "hidden"}
      animate="show"
      className={cn("flex h-full flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Geography</p>
          <h3 className="mt-1 text-base font-bold text-ink">Where we are hiring from</h3>
          <p className="mt-1 text-sm text-muted">
            {formatNumber(model.countriesRepresented)} countries ·{" "}
            {formatNumber(model.remoteOrUnspecified)} remote / unspecified
            {model.topCountry
              ? ` · Top: ${model.topCountry.name} (${formatNumber(model.topCountry.sourced)})`
              : ""}
          </p>
        </div>
        <Legend maxCount={model.maxCount} />
      </div>

      <div className="overflow-hidden rounded-xl border border-line/70 bg-surface" style={{ height }}>
        <ParentSize>
          {({ width, height: h }) => (
            <MapSvg width={width} height={h} model={model} />
          )}
        </ParentSize>
      </div>

      {model.byCountry.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {model.byCountry.slice(0, 6).map((row) => (
            <div
              key={row.iso2}
              className="flex items-center justify-between gap-2 rounded-lg border border-line/60 bg-paper/50 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                <p className="text-[0.65rem] text-muted">
                  Avg match {formatNumber(row.avgMatchScore)}
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums text-ink">{formatNumber(row.sourced)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Source candidates with a city or country in their profile to populate the map.
        </p>
      )}
    </motion.div>
  );
}
