import { Badge } from "@/components/ui";
import { PageHeader } from "@/components/app/page-header";
import { FloorMapView } from "@/components/architecture/floor-map-view";

export default function FloorMapPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Architecture"
        title="Floor map"
        description="The checked-in rooms of ARIA: ingress, policy, domain, delivery, authority, and runtime."
        actions={
          <Badge tone="success" dot>
            Synthetic demo data
          </Badge>
        }
      />
      <FloorMapView />
    </div>
  );
}
