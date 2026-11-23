import { Badge, Card, CardContent } from "@/components/ui";
import {
  ARCHITECTURE_FLOOR_MAP,
  FLOOR_ZONES,
  type FloorSideEffect,
} from "@/lib/architecture-floor-map";

const SIDE_EFFECT: Record<FloorSideEffect, { label: string; tone: "success" | "warning" | "electric" }> = {
  none: { label: "No side effects", tone: "success" },
  "demo-blocked": { label: "Demo blocked", tone: "warning" },
  "policy-gated": { label: "Policy gated", tone: "electric" },
};

export function FloorMapView() {
  const map = ARCHITECTURE_FLOOR_MAP;
  const roomsByZone = FLOOR_ZONES.map((zone) => ({
    zone,
    rooms: map.rooms.filter((room) => room.zone === zone.id),
  }));

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
        This floor describes checked-in source from {map.sourceGuide}. Figures are the synthetic demo
        workspace. The page does not read live credentials and does not send.
      </p>

      <section aria-labelledby="floor-boundaries">
        <h2 id="floor-boundaries" className="text-sm font-bold uppercase tracking-[0.1em] text-ink-soft">
          Not on this floor
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {map.prohibited.map((label) => (
            <li key={label}>
              <Badge tone="danger">{label}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {roomsByZone.map(({ zone, rooms }) => (
          <section key={zone.id} aria-labelledby={`floor-zone-${zone.id}`} className="space-y-3">
            <div>
              <h2 id={`floor-zone-${zone.id}`} className="text-lg font-bold text-ink">
                {zone.title}
              </h2>
              <p className="text-sm text-muted">{zone.detail}</p>
            </div>
            <div className="grid gap-3">
              {rooms.map((room) => {
                const effect = SIDE_EFFECT[room.sideEffect];
                return (
                  <Card key={room.id}>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-ink">{room.title}</h3>
                        <Badge tone={effect.tone} size="sm">
                          {effect.label}
                        </Badge>
                        {room.assistedManual && (
                          <Badge tone="warning" size="sm">
                            Assisted manual
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-ink-soft">{room.summary}</p>
                      <ul className="flex flex-wrap gap-2">
                        {room.paths.map((path) => (
                          <li key={path}>
                            <code className="rounded-md bg-ink/[0.05] px-2 py-1 text-xs text-ink-soft">{path}</code>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section aria-labelledby="floor-walk">
        <h2 id="floor-walk" className="text-sm font-bold uppercase tracking-[0.1em] text-ink-soft">
          Walk
        </h2>
        <ol className="mt-3 space-y-2">
          {map.edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`} className="text-sm text-ink">
              <span className="font-semibold">{edge.from}</span>
              <span className="text-muted"> → </span>
              <span className="font-semibold">{edge.to}</span>
              <span className="text-ink-soft"> · {edge.label}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
