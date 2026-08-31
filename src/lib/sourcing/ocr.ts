/**
 * Recover text from a PDF so a need or CV can be scored.
 * Text-layer PDFs are extracted here. Image-only / empty-text PDFs fail closed
 * as OCR_REQUIRED — see docs/sourcing-engine/DESIGN.md.
 */

export type PdfExtract =
  | { ok: true; text: string; method: "text-layer" }
  | { ok: false; code: "OCR_REQUIRED" | "NOT_PDF"; text: "" };

const MAX_CHARS = 20_000;

function unescapePdfLiteral(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function decodeHexPdfString(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length >= 4 && /^(feff|fffe)/i.test(clean)) {
    const bytes = Buffer.from(clean, "hex");
    const le = clean.slice(0, 4).toLowerCase() === "fffe";
    return bytes.slice(2).toString(le ? "utf16le" : "utf16le");
  }
  try {
    return Buffer.from(clean, "hex").toString("latin1");
  } catch {
    return "";
  }
}

/** Extract literal and hex PDF strings from Tj / TJ operators. */
export function extractPdfText(bytes: Uint8Array): PdfExtract {
  if (bytes.length < 5) return { ok: false, code: "NOT_PDF", text: "" };
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
  if (head !== "%PDF-") return { ok: false, code: "NOT_PDF", text: "" };

  const raw = new TextDecoder("latin1").decode(bytes);
  const parts: string[] = [];

  const literalRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  for (const match of raw.matchAll(literalRe)) {
    const inner = match[0].slice(1, match[0].lastIndexOf(")"));
    parts.push(unescapePdfLiteral(inner));
  }

  const hexRe = /<([0-9A-Fa-f \t\r\n]+)>\s*Tj/g;
  for (const match of raw.matchAll(hexRe)) {
    parts.push(decodeHexPdfString(match[1] ?? ""));
  }

  const arrayRe = /\[(.*?)\]\s*TJ/gs;
  for (const match of raw.matchAll(arrayRe)) {
    const body = match[1] ?? "";
    for (const lit of body.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      parts.push(unescapePdfLiteral(lit[0].slice(1, -1)));
    }
    for (const hex of body.matchAll(/<([0-9A-Fa-f \t\r\n]+)>/g)) {
      parts.push(decodeHexPdfString(hex[1] ?? ""));
    }
  }

  const text = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!text) return { ok: false, code: "OCR_REQUIRED", text: "" };
  return { ok: true, text, method: "text-layer" };
}

/** Minimal text-layer PDF for fixtures and tests. Not a live candidate. */
export function buildTextLayerPdf(text: string): Uint8Array {
  const safe = text.replace(/[()\\]/g, " ").slice(0, 1_200);
  const stream = `BT /F1 12 Tf 24 720 Td (${safe}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.1\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${xref}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
