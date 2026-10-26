// Parses supabase/migrations/0001_baseline.sql (pg_dump format) into named
// blocks so contract tests can assert on schema facts instead of on the text
// of historical migrations.
import { readFileSync } from "node:fs";

export interface SchemaBlock {
  name: string;
  type: string;
  sql: string;
}

export const BASELINE_PATH = "supabase/migrations/0001_baseline.sql";

export function loadBaselineSchema(path = BASELINE_PATH) {
  const source = readFileSync(path, "utf8");
  const blocks: SchemaBlock[] = [];
  const header = /^-- Name: (.+?); Type: ([A-Z ]+); Schema: [^;]*; Owner: -$/gm;
  const matches = [...source.matchAll(header)];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    blocks.push({ name: match[1], type: match[2], sql: source.slice(start, end).replace(/^\s*--\s*/, "").trim() });
  });

  const byType = (type: string) => blocks.filter((block) => block.type === type);
  const tables = byType("TABLE").map((block) => block.name);

  /** Full CREATE FUNCTION statement(s) for a function name (all overloads). */
  function fn(name: string): string {
    return byType("FUNCTION")
      .filter((block) => block.name.startsWith(`${name}(`))
      .map((block) => block.sql)
      .join("\n");
  }

  /** CREATE TABLE statement for a table. */
  function table(name: string): string {
    return byType("TABLE").find((block) => block.name === name)?.sql ?? "";
  }

  /** Every statement that targets a table: constraints, indexes, triggers, policies, RLS. */
  function tableDdl(name: string): string {
    const pattern = new RegExp(`\\bpublic\\.${name}\\b`);
    return blocks
      .filter((block) => block.type !== "FUNCTION" && pattern.test(block.sql))
      .map((block) => block.sql)
      .join("\n");
  }

  function rls(name: string): { enabled: boolean; forced: boolean } {
    return {
      enabled: new RegExp(`ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY;`).test(source),
      forced: new RegExp(`ALTER TABLE ONLY public\\.${name} FORCE ROW LEVEL SECURITY;`).test(source),
    };
  }

  /** Grantees per privilege for a table, e.g. { authenticated: ["SELECT"] }. */
  function tableGrants(name: string): Record<string, string[]> {
    const grants: Record<string, string[]> = {};
    const pattern = new RegExp(`^GRANT (.+?) ON TABLE public\\.${name} TO (\\w+);$`, "gm");
    for (const [, privileges, grantee] of source.matchAll(pattern)) {
      grants[grantee] = [...(grants[grantee] ?? []), ...privileges.split(",").map((p) => p.trim())].sort();
    }
    return grants;
  }

  /** Roles granted EXECUTE (or ALL) on any overload of a function. */
  function functionGrantees(name: string): string[] {
    const pattern = new RegExp(`^GRANT (?:ALL|EXECUTE) ON FUNCTION public\\.${name}\\(.*\\) TO (\\w+);$`, "gm");
    return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
  }

  const functionNames = [...new Set(byType("FUNCTION").map((block) => block.name.replace(/\(.*$/, "")))].sort();

  return { source, blocks, tables, functionNames, fn, table, tableDdl, rls, tableGrants, functionGrantees };
}
