/**
 * README loops must be short synthetic GIFs that exist in the repo.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const README = readFileSync(path.join(ROOT, "README.md"), "utf8");
const LOOPS = [
  "docs/media/command-center.gif",
  "docs/media/candidate-ranking.gif",
  "docs/media/exact-text-approval.gif",
];
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_SECONDS = 8;

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL ${label}`);
  }
}

function gifSeconds(bytes: Buffer): number | null {
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

check("README names the loops as synthetic", /synthetic/i.test(README));
check("README names the fixture people", README.includes("Ada Example") && README.includes("Jan Fixture"));
check("README does not embed the hired-gate loop", !README.includes("hired-gate.gif"));
check("README keeps the manifest pointer", README.includes("tests/test-manifest.mjs"));
check("README keeps the typecheck:tests gate", README.includes("npm run typecheck:tests"));

const recorderPath = path.join(ROOT, "scripts/record-readme-gifs.mjs");
check("recorder exists for this branch's demo", existsSync(recorderPath));
const recorder = existsSync(recorderPath) ? readFileSync(recorderPath, "utf8") : "";
check("recorder stays on the dry-run demo", recorder.includes("hermes-sourcing:v1") && !/ODOO|hired-gate|password/i.test(recorder));

for (const relative of LOOPS) {
  check(`README embeds ${relative}`, README.includes(`](${relative})`));
  const bytes = readFileSync(path.join(ROOT, relative));
  const size = statSync(path.join(ROOT, relative)).size;
  const seconds = gifSeconds(bytes);
  check(`${relative} is under 3 MB`, size > 0 && size <= MAX_BYTES);
  check(`${relative} loops in at most 8 seconds`, seconds != null && seconds <= MAX_SECONDS);
  check(`${relative} repeats`, bytes.includes(Buffer.from("NETSCAPE2.0")));
}

console.log(`RESULT readme-synthetic-media: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
