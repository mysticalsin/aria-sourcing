import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

import ts from "typescript";

export type ImportGraph = Map<string, Set<string>>;

export type ImportGraphOptions = {
  includeDynamic: boolean;
  includeTypeOnly: boolean;
};

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const serverOnlySpecifiers = new Set(["server-only", "next/headers", "next/server"]);

function parseSourceFile(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

export function isClientModule(file: string): boolean {
  for (const statement of parseSourceFile(file).statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === "use client") return true;
      continue;
    }
    break;
  }
  return false;
}

export function isServerOnlyModule(file: string, sourceRoot: string): boolean {
  const path = relative(sourceRoot, file).split("\\").join("/");
  if (path.startsWith("lib/server/")) return true;

  let serverOnly = false;
  const visit = (node: ts.Node) => {
    if (serverOnly) return;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      serverOnlySpecifiers.has(node.moduleSpecifier.text) &&
      staticDeclarationHasRuntimeEdge(node)
    ) {
      serverOnly = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      serverOnlySpecifiers.has(node.arguments[0].text) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      serverOnly = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSourceFile(file));
  return serverOnly;
}

export function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!entry.isFile() || entry.name.endsWith(".d.ts")) return [];
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function resolveSourceImport(
  sourceRoot: string,
  fromFile: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  const explicitExtension = extname(base);
  const candidates = explicitExtension
    ? [
        base,
        ...([".js", ".jsx", ".mjs", ".cjs"].includes(explicitExtension)
          ? [
              base.slice(0, -explicitExtension.length) + ".ts",
              base.slice(0, -explicitExtension.length) + ".tsx",
              base.slice(0, -explicitExtension.length) + ".mts",
              base.slice(0, -explicitExtension.length) + ".cts",
            ]
          : []),
      ]
    : [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.cts`,
        `${base}.js`,
        `${base}.jsx`,
        `${base}.mjs`,
        `${base}.cjs`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.mts"),
        join(base, "index.cts"),
        join(base, "index.js"),
        join(base, "index.jsx"),
        join(base, "index.mjs"),
        join(base, "index.cjs"),
      ];
  return candidates.find((candidate) => sourceFiles.has(candidate) && existsSync(candidate)) ?? null;
}

function staticDeclarationHasRuntimeEdge(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name) return true;
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      return true;
    }
    return Boolean(
      clause.namedBindings?.elements.some((element) => !element.isTypeOnly),
    );
  }

  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

export function buildImportGraph(
  sourceRoot: string,
  options: ImportGraphOptions,
): { graph: ImportGraph; dynamicImportCount: number } {
  const files = collectSourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph: ImportGraph = new Map(files.map((file) => [file, new Set()]));
  let dynamicImportCount = 0;

  for (const file of files) {
    const sourceFile = parseSourceFile(file);
    for (const node of sourceFile.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (!options.includeTypeOnly && !staticDeclarationHasRuntimeEdge(node)) continue;
      const dependency = resolveSourceImport(
        sourceRoot,
        file,
        node.moduleSpecifier.text,
        fileSet,
      );
      if (dependency) graph.get(file)!.add(dependency);
    }

    if (!options.includeDynamic) continue;
    const visitDynamicImports = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const dependency = resolveSourceImport(
          sourceRoot,
          file,
          node.arguments[0].text,
          fileSet,
        );
        if (dependency) {
          graph.get(file)!.add(dependency);
          dynamicImportCount += 1;
        }
      }
      ts.forEachChild(node, visitDynamicImports);
    };
    visitDynamicImports(sourceFile);
  }

  return { graph, dynamicImportCount };
}

function stronglyConnectedComponents(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

export function graphCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  sourceRoot: string,
): string[][] {
  return stronglyConnectedComponents(graph)
    .filter(
      (component) =>
        component.length > 1 || graph.get(component[0])?.has(component[0]),
    )
    .map((component) =>
      component
        .map((file) => relative(sourceRoot, file).split("\\").join("/"))
        .sort(),
    )
    .sort((left, right) => left[0].localeCompare(right[0]));
}
