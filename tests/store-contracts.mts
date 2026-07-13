import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import type { HermesActions as PublicHermesActions } from "../src/lib/store";
import {
  HermesProvider,
  useActions,
  useHermes,
  useHydrated,
} from "../src/lib/store";
import type {
  HermesActions as ContractHermesActions,
  HermesContextValue,
} from "../src/lib/store/contracts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

const publicContractMatches: Equal<PublicHermesActions, ContractHermesActions> = true;
const contextContractIncludesActions: ContractHermesActions =
  null as unknown as HermesContextValue["actions"];
void publicContractMatches;
void contextContractIncludesActions;

const storeSource = readFileSync(
  new URL("../src/lib/store.ts", import.meta.url),
  "utf8",
);
const contractsSource = readFileSync(
  new URL("../src/lib/store/contracts.ts", import.meta.url),
  "utf8",
);
const contractsAst = ts.createSourceFile(
  "contracts.ts",
  contractsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const storeAst = ts.createSourceFile(
  "store.ts",
  storeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function declaredName(node: { name?: ts.PropertyName }): string | null {
  if (!node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text;
  }
  return node.name.getText();
}

function findInterface(name: string): ts.InterfaceDeclaration {
  const declaration = contractsAst.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  assert.ok(declaration, `${name} interface must exist in store contracts`);
  return declaration;
}

test("store keeps HermesActions as a compatibility type export", () => {
  assert.match(
    storeSource,
    /export type \{ HermesActions \} from ["']\.\/store\/contracts["'];/,
  );
  assert.doesNotMatch(storeSource, /export interface HermesActions\s*\{/);
});

test("store contracts stay React-free and type-only", () => {
  assert.doesNotMatch(contractsSource, /["']use client["']/);
  assert.doesNotMatch(contractsSource, /from ["']react["']/);
  assert.doesNotMatch(contractsSource, /^import\s+(?!type\b)/m);
});

test("context contract preserves workspace recovery and recommendations", () => {
  assert.match(contractsSource, /workspaceStatus:\s*WorkspaceStatus/);
  assert.match(contractsSource, /retryWorkspace:\s*\(\) => Promise<void>/);
  assert.match(contractsSource, /retrySave:\s*\(\) => Promise<void>/);
  assert.match(contractsSource, /recommendations:\s*Recommendation\[\]/);
});

test("action contract, implementation object, and memo dependencies stay in parity", () => {
  const contractNames = findInterface("HermesActions").members
    .map(declaredName)
    .filter((name): name is string => name !== null);

  let actionsDeclaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "actions"
    ) {
      actionsDeclaration = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(storeAst);
  assert.ok(actionsDeclaration?.initializer);
  assert.ok(ts.isCallExpression(actionsDeclaration.initializer));

  const [factory, dependencyList] = actionsDeclaration.initializer.arguments;
  assert.ok(factory && ts.isArrowFunction(factory));
  const factoryBody = ts.isParenthesizedExpression(factory.body)
    ? factory.body.expression
    : factory.body;
  assert.ok(ts.isObjectLiteralExpression(factoryBody));
  assert.ok(dependencyList && ts.isArrayLiteralExpression(dependencyList));

  const implementationNames = factoryBody.properties
    .map(declaredName)
    .filter((name): name is string => name !== null);
  const dependencyNames = dependencyList.elements.map((element) => element.getText());

  assert.equal(contractNames.length, 127);
  assert.deepEqual([...implementationNames].sort(), [...contractNames].sort());
  assert.deepEqual([...dependencyNames].sort(), [...contractNames].sort());
});

test("context contract keeps its exact public shape", () => {
  const contextNames = findInterface("HermesContextValue").members
    .map(declaredName)
    .filter((name): name is string => name !== null)
    .sort();
  assert.deepEqual(contextNames, [
    "actions",
    "hydrated",
    "recommendations",
    "retrySave",
    "retryWorkspace",
    "state",
    "workspaceStatus",
  ]);
});

function StoreHookProbe() {
  const context = useHermes();
  const actions = useActions();
  const hydrated = useHydrated();

  assert.strictEqual(actions, context.actions);
  assert.equal(
    context.state === null,
    true,
    "provider must not expose state during server render",
  );
  assert.equal(context.workspaceStatus.phase, "loading");
  assert.equal(hydrated, false);
  assert.equal(context.recommendations.length, 0);

  return createElement(
    "output",
    null,
    `${context.workspaceStatus.phase}:${String(hydrated)}:${Object.keys(actions).length}`,
  );
}

test("public hooks preserve their provider-bound initial behavior", () => {
  const markup = renderToStaticMarkup(
    createElement(HermesProvider, null, createElement(StoreHookProbe)),
  );
  assert.equal(markup, "<output>loading:false:127</output>");
});

test("useHermes still rejects consumers outside HermesProvider", () => {
  assert.throws(
    () => renderToStaticMarkup(createElement(StoreHookProbe)),
    /useHermes must be used within <HermesProvider>\./,
  );
});

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!entry.isFile() || entry.name.endsWith(".d.ts")) return [];
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function resolveSourceImport(
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
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.mts"),
        join(base, "index.cts"),
      ];
  return candidates.find((candidate) => sourceFiles.has(candidate) && existsSync(candidate)) ?? null;
}

function stronglyConnectedComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
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
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node)!, indices.get(dependency)!),
        );
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

function buildImportGraph(options: {
  includeTypeOnly: boolean;
  includeDynamic: boolean;
}): { graph: Map<string, Set<string>>; dynamicImportCount: number } {
  const files = collectSourceFiles(sourceRoot);
  const fileSet = new Set(files);
  const graph = new Map<string, Set<string>>(files.map((file) => [file, new Set()]));
  let dynamicImportCount = 0;

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of sourceFile.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (!options.includeTypeOnly && !staticDeclarationHasRuntimeEdge(node)) continue;
      const dependency = resolveSourceImport(file, node.moduleSpecifier.text, fileSet);
      if (dependency) graph.get(file)!.add(dependency);
    }

    if (options.includeDynamic) {
      const visitDynamicImports = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const dependency = resolveSourceImport(
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
  }

  return { graph, dynamicImportCount };
}

function graphCycles(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  return stronglyConnectedComponents(graph)
    .filter(
      (component) =>
        component.length > 1 || graph.get(component[0])?.has(component[0]),
    )
    .map((component) =>
      component
        .map((file) => relative(sourceRoot, file))
        .sort(),
    )
    .sort((left, right) => left[0].localeCompare(right[0]));
}

test("cycle detector identifies two-node and self cycles", () => {
  const first = join(sourceRoot, "__cycle_fixture_a.ts");
  const second = join(sourceRoot, "__cycle_fixture_b.ts");
  const self = join(sourceRoot, "__cycle_fixture_self.ts");
  const graph = new Map<string, Set<string>>([
    [first, new Set([second])],
    [second, new Set([first])],
    [self, new Set([self])],
  ]);
  assert.deepEqual(graphCycles(graph), [
    ["__cycle_fixture_a.ts", "__cycle_fixture_b.ts"],
    ["__cycle_fixture_self.ts"],
  ]);
});

test("static import and re-export declaration graph remains acyclic", () => {
  const { graph } = buildImportGraph({
    includeTypeOnly: true,
    includeDynamic: false,
  });
  assert.deepEqual(graphCycles(graph), []);
});

test("runtime import graph including dynamic imports remains acyclic", () => {
  const { graph, dynamicImportCount } = buildImportGraph({
    includeTypeOnly: false,
    includeDynamic: true,
  });
  assert.ok(
    dynamicImportCount > 0,
    "runtime cycle check must inspect at least one dynamic import",
  );
  assert.deepEqual(graphCycles(graph), []);
});
