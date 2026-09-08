/**
 * Durable LLM wiki knowledge plane (Graphify + llm_wiki patterns).
 *
 * Brain / recall only — never grants contact permission (Postgres lease remains
 * the sole lock). Persistence is markdown on disk under ARIA_WIKI_DIR (or
 * ARIA_DATA_DIR/llm-wiki), not Supabase.
 *
 * Layout:
 *   {root}/{workspaceId}/{campaignId}/index.md
 *   {root}/{workspaceId}/{campaignId}/notes/{kind}__{slug}.md
 *   {root}/{workspaceId}/{campaignId}/edges.json
 */

import fs from "node:fs";
import path from "node:path";
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
  wikiPath?: string;
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

const NOTE_KINDS: KnowledgeNoteKind[] = [
  "purpose",
  "playbook",
  "objection",
  "who_what",
  "outcome",
];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

export function resolveWikiRoot(override?: string): string {
  const fromEnv =
    override?.trim() ||
    process.env.ARIA_WIKI_DIR?.trim() ||
    (process.env.ARIA_DATA_DIR?.trim()
      ? path.join(process.env.ARIA_DATA_DIR.trim(), "llm-wiki")
      : "");
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "data", "llm-wiki");
}

function campaignDir(root: string, workspaceId: string, campaignId: string): string {
  return path.join(root, sanitizePathSeg(workspaceId), sanitizePathSeg(campaignId));
}

function sanitizePathSeg(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "_";
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw.trim() };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { meta: {}, body: raw.trim() };
  const fm = raw.slice(4, end);
  const body = raw.slice(end + 5).trim();
  const meta: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

function writeNoteMarkdown(note: KnowledgeNote): string {
  return [
    "---",
    `id: ${note.id}`,
    `kind: ${note.kind}`,
    `title: ${JSON.stringify(note.title)}`,
    `updatedAt: ${note.updatedAt}`,
    `workspaceId: ${note.workspaceId}`,
    `campaignId: ${note.campaignId}`,
    "---",
    "",
    note.body.trim(),
    "",
  ].join("\n");
}

export class FileWikiKnowledgePlane {
  readonly writeQueue = new SerialWikiWriteQueue();
  private readonly root: string;
  /** Hot cache — disk is source of truth after each write. */
  private notes = new Map<string, KnowledgeNote>();
  private edges = new Map<string, KnowledgeEdge>();

  constructor(root?: string) {
    this.root = resolveWikiRoot(root);
  }

  get wikiRoot(): string {
    return this.root;
  }

  private noteKey(workspaceId: string, campaignId: string, id: string) {
    return `${workspaceId}::${campaignId}::${id}`;
  }

  private ensureCampaignScaffold(workspaceId: string, campaignId: string) {
    const dir = campaignDir(this.root, workspaceId, campaignId);
    const notesDir = path.join(dir, "notes");
    fs.mkdirSync(notesDir, { recursive: true });
    const indexPath = path.join(dir, "index.md");
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(
        indexPath,
        [
          `# Campaign wiki — ${campaignId}`,
          "",
          "LLM wiki brain for this campaign. Notes under `notes/` are recall-only.",
          "Contact permission comes only from the Postgres contact lease — never from this wiki.",
          "",
          `workspace: ${workspaceId}`,
          "",
        ].join("\n"),
        "utf8",
      );
    }
    const edgesPath = path.join(dir, "edges.json");
    if (!fs.existsSync(edgesPath)) {
      fs.writeFileSync(edgesPath, "[]\n", "utf8");
    }
    return dir;
  }

  private loadCampaignFromDisk(workspaceId: string, campaignId: string) {
    const dir = campaignDir(this.root, workspaceId, campaignId);
    const notesDir = path.join(dir, "notes");
    if (!fs.existsSync(notesDir)) return;
    for (const file of fs.readdirSync(notesDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = fs.readFileSync(path.join(notesDir, file), "utf8");
        const { meta, body } = parseFrontmatter(raw);
        const kind = (NOTE_KINDS.includes(meta.kind as KnowledgeNoteKind)
          ? meta.kind
          : "who_what") as KnowledgeNoteKind;
        const id = meta.id || path.basename(file, ".md");
        const note: KnowledgeNote = {
          id,
          workspaceId: meta.workspaceId || workspaceId,
          campaignId: meta.campaignId || campaignId,
          kind,
          title: meta.title || id,
          body,
          updatedAt: meta.updatedAt || new Date().toISOString(),
        };
        this.notes.set(this.noteKey(workspaceId, campaignId, id), note);
      } catch {
        /* skip corrupt note */
      }
    }
    const edgesPath = path.join(dir, "edges.json");
    if (fs.existsSync(edgesPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(edgesPath, "utf8")) as KnowledgeEdge[];
        if (Array.isArray(parsed)) {
          for (const edge of parsed) {
            if (!edge?.id) continue;
            this.edges.set(this.noteKey(workspaceId, campaignId, edge.id), {
              ...edge,
              workspaceId: edge.workspaceId || workspaceId,
              campaignId: edge.campaignId || campaignId,
            });
          }
        }
      } catch {
        /* skip */
      }
    }
  }

  private persistEdges(workspaceId: string, campaignId: string) {
    const dir = this.ensureCampaignScaffold(workspaceId, campaignId);
    const prefix = `${workspaceId}::${campaignId}::`;
    const list = [...this.edges.values()].filter((e) =>
      this.noteKey(e.workspaceId, e.campaignId, e.id).startsWith(prefix),
    );
    fs.writeFileSync(path.join(dir, "edges.json"), `${JSON.stringify(list, null, 2)}\n`, "utf8");
  }

  async upsertNote(note: Omit<KnowledgeNote, "updatedAt"> & { updatedAt?: string }): Promise<KnowledgeNote> {
    const saved: KnowledgeNote = {
      ...note,
      updatedAt: note.updatedAt ?? new Date().toISOString(),
    };
    await this.writeQueue.enqueue(() => {
      this.ensureCampaignScaffold(note.workspaceId, note.campaignId);
      this.notes.set(this.noteKey(note.workspaceId, note.campaignId, note.id), saved);
      const file = path.join(
        campaignDir(this.root, note.workspaceId, note.campaignId),
        "notes",
        `${note.kind}__${slugify(note.title)}.md`,
      );
      fs.writeFileSync(file, writeNoteMarkdown(saved), "utf8");
    });
    return saved;
  }

  async upsertEdge(edge: Omit<KnowledgeEdge, "updatedAt"> & { updatedAt?: string }): Promise<KnowledgeEdge> {
    const saved: KnowledgeEdge = {
      ...edge,
      updatedAt: edge.updatedAt ?? new Date().toISOString(),
    };
    await this.writeQueue.enqueue(() => {
      this.ensureCampaignScaffold(edge.workspaceId, edge.campaignId);
      this.edges.set(this.noteKey(edge.workspaceId, edge.campaignId, edge.id), saved);
      this.persistEdges(edge.workspaceId, edge.campaignId);
    });
    return saved;
  }

  readCampaign(workspaceId: string, campaignId: string): KnowledgeSnapshot {
    this.loadCampaignFromDisk(workspaceId, campaignId);
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
      wikiPath: campaignDir(this.root, workspaceId, campaignId),
    };
  }

  /** Compile a short "who/what we know" brief for drafting / sourcing (never a contact grant). */
  compileDraftContext(workspaceId: string, campaignId: string): string {
    const snap = this.readCampaign(workspaceId, campaignId);
    const lines: string[] = [
      "Campaign knowledge (recall only — contact permission comes from the Postgres lease):",
      `Wiki path: ${snap.wikiPath}`,
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

  /** Suggested GitHub search query from wiki who_what / purpose notes. */
  suggestGithubQuery(workspaceId: string, campaignId: string): string | null {
    const snap = this.readCampaign(workspaceId, campaignId);
    const who = snap.notes.find((n) => n.kind === "who_what");
    const purpose = snap.notes.find((n) => n.kind === "purpose");
    const text = `${who?.body ?? ""} ${purpose?.body ?? ""}`;
    if (/java/i.test(text)) {
      return "language:Java followers:>20";
    }
    return null;
  }
}

/** @deprecated Alias — in-memory tests can still construct FileWiki with a temp root. */
export class InMemoryKnowledgePlane extends FileWikiKnowledgePlane {
  constructor() {
    super(path.join(process.env.TMPDIR || "/tmp", `aria-wiki-mem-${process.pid}-${Date.now()}`));
  }
}

/** Process-local default plane — durable markdown wiki under data/llm-wiki. */
export const defaultKnowledgePlane = new FileWikiKnowledgePlane();

/** Seed the Java Developer opportunity wiki (idempotent upserts). */
export async function seedJavaDeveloperWiki(
  workspaceId: string,
  campaignId: string,
  plane: FileWikiKnowledgePlane = defaultKnowledgePlane,
): Promise<KnowledgeSnapshot> {
  await plane.upsertNote({
    id: "java_purpose",
    workspaceId,
    campaignId,
    kind: "purpose",
    title: "Java Developer opportunity",
    body:
      "Hire Senior Java Developers for platform / backend roles. Focus on Spring Boot, " +
      "microservices, Kafka, and production JVM experience. Prefer EU/UK or remote-friendly.",
  });
  await plane.upsertNote({
    id: "java_who_what",
    workspaceId,
    campaignId,
    kind: "who_what",
    title: "Must-have profile",
    body:
      "Java 17+, Spring Boot, REST/gRPC, relational DBs, CI/CD. Nice: Kafka, Kubernetes, " +
      "observability. Signal: public GitHub with Java repos, contributions, or JVM systems work.",
  });
  await plane.upsertNote({
    id: "java_playbook",
    workspaceId,
    campaignId,
    kind: "playbook",
    title: "Sourcing playbook",
    body:
      "1) Read this wiki. 2) Search GitHub with language:Java followers:>20 (and refine by location). " +
      "3) Score against must-haves. 4) Draft low-pressure outreach from verified work only. " +
      "5) Never treat wiki recall as contact permission — claim_contact / lease only.",
  });
  await plane.upsertNote({
    id: "java_objection",
    workspaceId,
    campaignId,
    kind: "objection",
    title: "Common objections",
    body:
      "Comp band unclear → share range early. Remote policy → state locationType. " +
      "Too many greenfield pitches → emphasize platform ownership and JVM depth.",
  });
  await plane.upsertNote({
    id: "java_outcome",
    workspaceId,
    campaignId,
    kind: "outcome",
    title: "Success outcome",
    body:
      "Shortlist of real GitHub-backed Java profiles with match rationale and first-touch drafts " +
      "ready for human review — no fabricated candidates.",
  });
  await plane.upsertEdge({
    id: "edge_java_spring",
    workspaceId,
    campaignId,
    kind: "EXTRACTED",
    fromLabel: "Java Developer",
    toLabel: "Spring Boot",
    relation: "requires",
  });
  await plane.upsertEdge({
    id: "edge_java_kafka",
    workspaceId,
    campaignId,
    kind: "INFERRED",
    fromLabel: "platform role",
    toLabel: "Kafka",
    relation: "prefers",
  });
  return plane.readCampaign(workspaceId, campaignId);
}
