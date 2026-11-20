export type AuditKind = "manual-approval" | "qc-pass" | "auto-mode" | "kill-switch" | "send";

export interface AuditEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: AuditKind;
  readonly outcome: "allowed" | "refused";
  readonly reason: string;
  readonly actor: string;
  readonly messageId: string | null;
  readonly campaignId: string | null;
  readonly channel: string | null;
  readonly bodyHash: string | null;
}

export type AuditDraft = Omit<AuditEntry, "seq">;

/** Append-only decision trail. Entries are frozen. There is no update or delete. */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];

  append(entry: AuditDraft): AuditEntry {
    const stored = Object.freeze({ ...entry, seq: this.entries.length + 1 });
    this.entries.push(stored);
    return stored;
  }

  snapshot(): AuditEntry[] {
    return this.entries.slice();
  }
}
