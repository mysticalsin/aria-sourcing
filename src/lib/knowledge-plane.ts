/**
 * Minimal campaign knowledge plane (Graphify + llm_wiki patterns).
 * READ-ONLY for contact permission — never grants claim_contact.
 * Agents may read notes before drafting; Postgres contact lease remains sole lock.
 */

import { knowledgePlaneMayGrantContactClaim } from "@/lib/contact-lease";

export type KnowledgeNoteKind = "purpose" | "playbook" | "objection" | "who_what" | "outcome";

export type KnowledgeNote = {
  id: string;
  workspaceId: string;
  campaignId: string;
  kind: KnowledgeNoteKind;
  title: string;
  body: string;
  updatedAt: string;
};

export type KnowledgeEdgeKind = "EXTRACTED" | "INFERRED";

export type KnowledgeEdge = {
  id: string;
  workspaceId: string;
  campaignId: string;
  kind: KnowledgeEdgeKind;
  fromLabel: string;
  toLabel: string;
  relation: string;
  updatedAt: string;
};

export type KnowledgeSnapshot = {
  notes: KnowledgeNote[];
  edges: KnowledgeEdge[];
  /** Always false — contact locks live in contact_leases only. */
  grantsContactClaim: false;
};

type WikiQueueItem = { run: () => void };

/** Serial write queue (llm_wiki-style) so concurrent compilers don't clobber notes. */
export class SerialWikiWriteQueue {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  enqueue(run: () => void): Promise<void> {
    this.pending++;
    const item: WikiQueueItem = { run };
    this.chain = this.chain.then(() => {
      try {
        item.run();
      } finally {
        this.pending--;
      }
    });
    return this.chain;
  }

  depth(): number {
    return this.pending;
  }
}

export class InMemoryKnowledgePlane {
  private notes = new Map<string, KnowledgeNote>();
  private edges = new Map<string, KnowledgeEdge>();
  readonly writeQueue = new SerialWikiWriteQueue();

  private noteKey(workspaceId: string, campaignId: string, id: string) {
    return `${workspaceId}::${campaignId}::${id}`;
  }

  async upsertNote(note: Omit<KnowledgeNote, "updatedAt"> & { updatedAt?: string }): Promise<KnowledgeNote> {
    const saved: KnowledgeNote = {
      ...note,
      updatedAt: note.updatedAt ?? new Date().toISOString(),
    };
    await this.writeQueue.enqueue(() => {
      this.notes.set(this.noteKey(note.workspaceId, note.campaignId, note.id), saved);
    });
    return saved;
  }

  async upsertEdge(edge: Omit<KnowledgeEdge, "updatedAt"> & { updatedAt?: string }): Promise<KnowledgeEdge> {
    const saved: KnowledgeEdge = {
      ...edge,
      updatedAt: edge.updatedAt ?? new Date().toISOString(),
    };
    await this.writeQueue.enqueue(() => {
      this.edges.set(this.noteKey(edge.workspaceId, edge.campaignId, edge.id), saved);
    });
    return saved;
  }

  readCampaign(workspaceId: string, campaignId: string): KnowledgeSnapshot {
    const prefix = `${workspaceId}::${campaignId}::`;
    const notes = [...this.notes.values()].filter((n) =>
      this.noteKey(n.workspaceId, n.campaignId, n.id).startsWith(prefix),
    );
    const edges = [...this.edges.values()].filter((e) =>
      this.noteKey(e.workspaceId, e.campaignId, e.id).startsWith(prefix),
    );
    return {
      notes,
      edges,
      grantsContactClaim: knowledgePlaneMayGrantContactClaim(),
    };
  }

  /** Compile a short "who/what we know" brief for drafting (never a contact grant). */
  compileDraftContext(workspaceId: string, campaignId: string): string {
    const snap = this.readCampaign(workspaceId, campaignId);
    const lines: string[] = [
      "Campaign knowledge (recall only — contact permission comes from the Postgres lease):",
    ];
    for (const n of snap.notes.slice(0, 12)) {
      lines.push(`- [${n.kind}] ${n.title}: ${n.body.slice(0, 240)}`);
    }
    for (const e of snap.edges.slice(0, 12)) {
      lines.push(`- (${e.kind}) ${e.fromLabel} -[${e.relation}]-> ${e.toLabel}`);
    }
    if (snap.notes.length === 0 && snap.edges.length === 0) {
      lines.push("- (empty wiki — draft from the role brief alone)");
    }
    return lines.join("\n");
  }
}

/** Process-local default plane for unit tests and MVP in-app reads. */
export const defaultKnowledgePlane = new InMemoryKnowledgePlane();
