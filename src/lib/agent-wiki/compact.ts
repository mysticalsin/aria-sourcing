import {
  type WikiNote,
  readWikiNote,
  serializeWikiNote,
  writeWikiNote,
} from "./notes";

export type CompactInput = {
  winnerPath: string;
  loserPaths: string[];
  reason: string;
  root?: string;
};

export type CompactResult = {
  winner: WikiNote;
  superseded: WikiNote[];
  writtenPaths: string[];
};

/**
 * Compact multiple lesson notes into the winner: union evidence, record
 * supersedes, trim body, mark losers superseded. Never deletes files.
 */
export function compactNotes(input: CompactInput): CompactResult {
  const winner = readWikiNote(input.winnerPath);
  const losers = input.loserPaths.map((p) => readWikiNote(p));
  const evidence = Array.from(
    new Set([...winner.frontmatter.evidence, ...losers.flatMap((l) => l.frontmatter.evidence)]),
  );
  const supersedes = Array.from(
    new Set([
      ...winner.frontmatter.supersedes,
      ...losers.map((l) => l.frontmatter.id),
      ...losers.flatMap((l) => l.frontmatter.supersedes),
    ]),
  );

  const compactBody = [
    winner.body.trim(),
    "",
    "## Compaction",
    input.reason.trim(),
    "",
    `Supersedes: ${supersedes.join(", ") || "(none)"}`,
    `Evidence count: ${evidence.length}`,
  ]
    .join("\n")
    .split("\n")
    .slice(0, 60)
    .join("\n");

  const nextWinner: WikiNote = {
    ...winner,
    frontmatter: {
      ...winner.frontmatter,
      status: "canonical",
      updated: new Date().toISOString().slice(0, 10),
      supersedes,
      evidence,
    },
    body: compactBody,
    raw: "",
  };
  nextWinner.raw = serializeWikiNote(nextWinner);

  const writtenPaths: string[] = [];
  writeWikiNote(input.winnerPath, nextWinner);
  writtenPaths.push(input.winnerPath);

  const superseded: WikiNote[] = [];
  for (const loser of losers) {
    const nextLoser: WikiNote = {
      ...loser,
      frontmatter: {
        ...loser.frontmatter,
        status: "superseded",
        updated: new Date().toISOString().slice(0, 10),
      },
      body: `${loser.body.trim()}\n\n> Superseded by \`${winner.frontmatter.id}\`: ${input.reason.trim()}\n`,
      raw: "",
    };
    nextLoser.raw = serializeWikiNote(nextLoser);
    writeWikiNote(loser.path, nextLoser);
    writtenPaths.push(loser.path);
    superseded.push(nextLoser);
  }

  return { winner: nextWinner, superseded, writtenPaths };
}
