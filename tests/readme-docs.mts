/**
 * Docs check for the public README.
 *
 * Fails unless README.md:
 * - links only to paths that exist in this repo (external URLs are left alone),
 * - embeds 3 or 4 loops under docs/media/, each a GIF under 3 MB and at most 8 seconds,
 * - contains a mermaid architecture diagram and a mermaid stage diagram,
 * - includes the public sections a reader needs, and
 * - passes the markdown lint rules at the bottom of this file.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const README_PATH = path.join(ROOT, "README.md");
const MEDIA_HREF = /^docs\/media\/[A-Za-z0-9._-]+\.gif$/;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const MAX_LOOP_SECONDS = 8;
const REQUIRED_SECTIONS = [
  "Quick start",
  "How it works",
  "Safety and compliance",
  "Testing",
  "Project status",
  "Credits",
];

let failed = 0;

function fail(name: string): void {
  failed += 1;
  console.error("FAIL:", name);
}

function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

interface MarkdownLink {
  kind: "image" | "link";
  target: string;
  line: number;
}

function stripCodeFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
}

function markdownLinks(markdown: string): MarkdownLink[] {
  const source = stripCodeFences(markdown);
  const links: MarkdownLink[] = [];
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/(!?)\[(?:\\.|[^\]])*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      links.push({
        kind: match[1] === "!" ? "image" : "link",
        target: match[2],
        line: index + 1,
      });
    }
    const ref = /^\[(?:\\.|[^\]]+)\]:\s+(\S+)/.exec(line);
    if (ref) links.push({ kind: "link", target: ref[1], line: index + 1 });
  });
  return links;
}

function isExternal(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function gifLoopSeconds(bytes: Buffer): number | null {
  if (bytes.length < 13 || bytes.toString("ascii", 0, 3) !== "GIF") return null;
  const packed = bytes[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let centiseconds = 0;
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) break;
    if (marker === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      const imagePacked = bytes[offset + 9];
      offset += 10;
      if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      offset += 1;
      while (offset < bytes.length) {
        const block = bytes[offset];
        offset += 1;
        if (block === 0) break;
        offset += block;
      }
      continue;
    }
    if (marker !== 0x21 || offset + 2 > bytes.length) return null;
    const label = bytes[offset + 1];
    offset += 2;
    if (label === 0xf9) {
      if (offset + 6 > bytes.length || bytes[offset] !== 4) return null;
      const delay = bytes.readUInt16LE(offset + 2);
      centiseconds += delay === 0 ? 10 : delay;
      frames += 1;
      offset += 6;
      continue;
    }
    while (offset < bytes.length) {
      const block = bytes[offset];
      offset += 1;
      if (block === 0) break;
      offset += block;
    }
  }
  if (frames === 0) return null;
  return centiseconds / 100;
}

function lintMarkdown(markdown: string): string[] {
  const errors: string[] = [];
  if (!markdown.endsWith("\n")) errors.push("MD047: file must end with a single newline");
  if (markdown.endsWith("\n\n")) errors.push("MD047: file ends with extra blank lines");
  const lines = markdown.replace(/\n$/, "").split("\n");
  let inFence = false;
  let fenceLanguage = "";
  let previousBlank = false;
  let lastHeadingLevel = 0;
  const headingLines = new Set<number>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.includes("\t")) errors.push(`MD010:${lineNo}: tab character`);
    if (/[ \t]+$/.test(line)) errors.push(`MD009:${lineNo}: trailing whitespace`);
    if (line.startsWith("```")) {
      if (!inFence) {
        fenceLanguage = line.slice(3).trim();
        if (fenceLanguage === "") errors.push(`MD040:${lineNo}: fenced block needs a language`);
        if (index > 0 && lines[index - 1] !== "") errors.push(`MD031:${lineNo}: blank line required before a fence`);
      } else if (index + 1 < lines.length && lines[index + 1] !== "" && !lines[index + 1].startsWith("```")) {
        errors.push(`MD031:${lineNo}: blank line required after a fence`);
      }
      inFence = !inFence;
      previousBlank = false;
      return;
    }
    if (inFence) {
      previousBlank = false;
      return;
    }
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line) ?? (/^(#{1,6})([^ \t#].*)$/.exec(line));
    if (heading && heading[2] !== undefined && !heading[0].includes(" #")) {
      if (!/^#{1,6} /.test(line)) errors.push(`MD018:${lineNo}: heading needs a space after the hashes`);
      const level = heading[1].length;
      if (lastHeadingLevel !== 0 && level > lastHeadingLevel + 1) {
        errors.push(`MD001:${lineNo}: heading jumps from h${lastHeadingLevel} to h${level}`);
      }
      lastHeadingLevel = level;
      headingLines.add(index);
      if (index > 0 && lines[index - 1] !== "") errors.push(`MD022:${lineNo}: blank line required before a heading`);
      if (index + 1 < lines.length && lines[index + 1] !== "") errors.push(`MD022:${lineNo}: blank line required after a heading`);
    }
    if (line === "") {
      if (previousBlank) errors.push(`MD012:${lineNo}: consecutive blank lines`);
      previousBlank = true;
    } else {
      previousBlank = false;
    }
  });
  if (inFence) errors.push("MD031: unclosed fence");

  lines.forEach((line, index) => {
    if (headingLines.has(index) || line.startsWith("```")) return;
    if (!/^(\s*)([-*+]|\d+\.) /.test(line)) return;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent > 0) return;
    const before = index > 0 ? lines[index - 1] : "";
    const beforeIsList = /^([-*+]|\d+\.) /.test(before);
    if (index > 0 && before !== "" && !beforeIsList) {
      errors.push(`MD032:${index + 1}: blank line required before a list`);
    }
  });
  return errors;
}

function mermaidBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const fence = /```mermaid\r?\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(fence)) blocks.push(match[1]);
  return blocks;
}

if (!existsSync(README_PATH)) {
  fail("README.md exists");
} else {
  const markdown = readFileSync(README_PATH, "utf8");
  const headings = [...markdown.matchAll(/^#{1,6} +(.+)$/gm)].map((match) => match[1]);
  const slugs = new Set(headings.map(githubSlug));

  for (const section of REQUIRED_SECTIONS) {
    const found = headings.some((heading) => heading.toLowerCase().includes(section.toLowerCase()));
    if (!found) fail(`README has a "${section}" section`);
  }

  const diagrams = mermaidBlocks(markdown);
  if (!diagrams.some((block) => /^\s*(?:flowchart|graph)\s+/m.test(block))) {
    fail("README has a mermaid architecture diagram (flowchart or graph)");
  }
  if (!diagrams.some((block) => /^\s*stateDiagram(?:-v2)?\s*$/m.test(block))) {
    fail("README has a mermaid state diagram of the pipeline stages");
  }

  const media: string[] = [];
  for (const link of markdownLinks(markdown)) {
    if (isExternal(link.target)) continue;
    const [rawPath, rawAnchor] = link.target.split("#");
    const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : "";
    if (rawPath === "" || rawPath === undefined) {
      if (anchor && !slugs.has(githubSlug(anchor))) fail(`README#${anchor} on line ${link.line} matches a heading`);
      continue;
    }
    let decoded = rawPath;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      fail(`README link on line ${link.line} is valid percent-encoding: ${rawPath}`);
      continue;
    }
    if (decoded.split("/").some((part) => part === "..")) {
      fail(`README link on line ${link.line} stays inside the repo: ${decoded}`);
      continue;
    }
    const absolute = path.resolve(ROOT, decoded);
    if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
      fail(`README link on line ${link.line} stays inside the repo: ${decoded}`);
      continue;
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      fail(`README link on line ${link.line} resolves to a file: ${decoded}`);
      continue;
    }
    if (link.kind === "image" && MEDIA_HREF.test(decoded.replaceAll("\\", "/"))) media.push(decoded);
  }

  if (media.length < 3 || media.length > 4) {
    fail(`README embeds 3 or 4 docs/media GIF loops (found ${media.length})`);
  }
  for (const relative of media) {
    const absolute = path.resolve(ROOT, relative);
    const size = statSync(absolute).size;
    if (size <= 0 || size >= MAX_MEDIA_BYTES) {
      fail(`${relative} is under 3 MB (size ${size})`);
    }
    const seconds = gifLoopSeconds(readFileSync(absolute));
    if (seconds === null || seconds > MAX_LOOP_SECONDS) {
      fail(`${relative} is a GIF loop of at most ${MAX_LOOP_SECONDS}s (measured ${seconds})`);
    }
  }

  const lintErrors = lintMarkdown(markdown);
  if (lintErrors.length > 0) {
    fail(`markdown lint passes (${lintErrors.length} issue(s))`);
    for (const error of lintErrors.slice(0, 20)) console.error("  ", error);
  }
}

console.log(failed === 0 ? "RESULT readme-docs: passed" : `RESULT readme-docs: ${failed} failed`);
if (failed > 0) process.exitCode = 1;
