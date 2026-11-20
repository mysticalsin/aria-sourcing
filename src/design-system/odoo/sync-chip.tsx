import { Icon, type IconName } from "../primitives/icon";

export const ODOO_SYNC_STATUSES = ["synced", "pending", "failed", "local"] as const;
export type OdooSyncStatus = (typeof ODOO_SYNC_STATUSES)[number];

const COPY: Record<OdooSyncStatus, { label: string; icon: IconName }> = {
  synced: { label: "Synced to Odoo", icon: "check" },
  pending: { label: "Odoo sync pending", icon: "clock" },
  failed: { label: "Odoo sync failed", icon: "alert" },
  local: { label: "Only in Aria", icon: "cloud" },
};

export function OdooSyncChip({ status }: { status: OdooSyncStatus }) {
  const copy = COPY[status];
  return (
    <span className={`ds-chip ds-chip-${status}`} data-odoo-status={status}>
      <Icon name={copy.icon} />
      {copy.label}
    </span>
  );
}
