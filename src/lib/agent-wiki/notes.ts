import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export type WikiNoteStatus = "draft" | "proposed" | "canonical" | "superseded" | "rejected";
export type WikiNoteKind =
  | "agent"
  | "sourcing"
  | "identity"
  | "feedback"
  | "safety"
  | "schema"
  | "template"
  | "lesson"
  | "ops"
  | "meta";

export type WikiFrontmatter = {
  id: string;
  kind: WikiNoteKind;
  status: WikiNoteStatus;
  updated: string;
  supersedes: string[];
  evidence: string[];
  roleFingerprint?: string | null;
  identityFingerprint?: string | null;
};

export type WikiNote = {
  path: string;
  frontmatter: WikiFrontmatter;
  body: string;
  raw: string;
};

const DEFAULT_ROOT = "docs/agent-wiki";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_RE = /https?:\/\/[^\s)]+/gi;

export function stripAccidentalPii(text: string): string {
  return text.replace(EMAIL_RE, "[redacted-email]").replace(URL_RE, "[redacted-url]");
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim() && value.trim() !== "[]") {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

/** Minimal YAML frontmatter parser for our constrained note schema. */
export function parseWikiNote(raw: string, path = ""): WikiNote {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) {
    throw new Error(`wiki note missing frontmatter: ${path || "(memory)"}`);
  }
  const yaml = match[1]!;
  const body = match[2] ?? "";
  const fields: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Support multi-line YAML lists: `evidence:\n  - a\n  - b`
    if (!value && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? "")) {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? "")) {
        i += 1;
        items.push((lines[i] ?? "").replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      }
      value = `[${items.map((s) => JSON.stringify(s)).join(", ")}]`;
    }
    fields[key] = value;
  }
  const frontmatter: WikiFrontmatter = {
    id: fields.id ?? "",
    kind: (fields.kind as WikiNoteKind) || "lesson",
    status: (fields.status as WikiNoteStatus) || "draft",
    updated: fields.updated ?? new Date().toISOString().slice(0, 10),
    supersedes: parseList(fields.supersedes),
    evidence: parseList(fields.evidence),
    roleFingerprint: fields.roleFingerprint === "null" ? null : fields.roleFingerprint ?? null,
    identityFingerprint:
      fields.identityFingerprint === "null" ? null : fields.identityFingerprint ?? null,
  };
  if (!frontmatter.id) throw new Error(`wiki note missing id: ${path || "(memory)"}`);
  return { path, frontmatter, body, raw };
}

export function serializeWikiNote(note: Omit<WikiNote, "raw" | "path"> & { path?: string }): string {
  const fm = note.frontmatter;
  const lines = [
    "---",
    `id: ${fm.id}`,
    `kind: ${fm.kind}`,
    `status: ${fm.status}`,
    `updated: ${fm.updated}`,
    `supersedes: [${fm.supersedes.map((s) => JSON.stringify(s)).join(", ")}]`,
    `evidence: [${fm.evidence.map((s) => JSON.stringify(s)).join(", ")}]`,
    `roleFingerprint: ${fm.roleFingerprint ? JSON.stringify(fm.roleFingerprint) : "null"}`,
    `identityFingerprint: ${fm.identityFingerprint ? JSON.stringify(fm.identityFingerprint) : "null"}`,
    "---",
    "",
    stripAccidentalPii(note.body).replace(/^\n+/, ""),
  ];
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function wikiRoot(root = DEFAULT_ROOT): string {
  return root;
}

export function listWikiMarkdownFiles(root = DEFAULT_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export function readWikiNote(path: string): WikiNote {
  const raw = readFileSync(path, "utf8");
  return parseWikiNote(raw, path);
}

export function writeWikiNote(path: string, note: Omit<WikiNote, "raw" | "path">): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeWikiNote({ ...note, path }), "utf8");
}

export function loadCanonicalLessons(root = DEFAULT_ROOT): WikiNote[] {
  return listWikiMarkdownFiles(join(root, "lessons"))
    .map((path) => readWikiNote(path))
    .filter((n) => n.frontmatter.kind === "lesson" && n.frontmatter.status === "canonical");
}

export function relativeWikiPath(path: string, root = DEFAULT_ROOT): string {
  return relative(root, path).replace(/\\/g, "/");
}
