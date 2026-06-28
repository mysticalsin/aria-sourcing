// Ported from iamlukethedev/Claw3D (MIT License)
// Simplified: no furniture blocking (open floor plan), no specialty rooms.

import { CANVAS_H, CANVAS_W } from "./constants";

// ---------------------------------------------------------------------------
// Desk positions (canvas pixel coords) — agents in "working" state walk here
// 5 columns × 8 rows = 40 desks
// ---------------------------------------------------------------------------
const DESK_COL_X = [200, 400, 600, 800, 1000] as const;
const DESK_ROW_Y = [250, 450, 650, 850, 1050, 1250, 1450, 1650] as const;

export const DESK_POSITIONS: { x: number; y: number }[] = DESK_ROW_Y.flatMap(
  (y) => DESK_COL_X.map((x) => ({ x, y })),
);

// ---------------------------------------------------------------------------
// Roam points (canvas pixel coords) — agents in "idle" state walk between these
// ---------------------------------------------------------------------------
export const ROAM_POINTS: { x: number; y: number }[] = [
  { x: 1320, y: 280 },
  { x: 1500, y: 480 },
  { x: 1320, y: 680 },
  { x: 1500, y: 880 },
  { x: 1320, y: 1080 },
  { x: 1500, y: 1280 },
  { x: 1320, y: 1480 },
];

// ---------------------------------------------------------------------------
// Nav grid — A* pathfinding
// ---------------------------------------------------------------------------
const GRID_CELL = 25;
const GRID_COLS = Math.ceil(CANVAS_W / GRID_CELL); // 72
const GRID_ROWS = Math.ceil(CANVAS_H / GRID_CELL); // 72

export type NavGrid = Uint8Array;

/**
 * Build a navigation grid. For our simplified open-plan office we only
 * block the canvas border cells. Pass an empty array for a fully open grid.
 */
export function buildNavGrid(_furniture: unknown[] = []): NavGrid {
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS);
  // Block border cells so agents cannot walk off the canvas edge.
  for (let c = 0; c < GRID_COLS; c += 1) {
    grid[c] = 1;
    grid[(GRID_ROWS - 1) * GRID_COLS + c] = 1;
  }
  for (let r = 0; r < GRID_ROWS; r += 1) {
    grid[r * GRID_COLS] = 1;
    grid[r * GRID_COLS + GRID_COLS - 1] = 1;
  }
  return grid;
}

// ---------------------------------------------------------------------------
// A* pathfinder (8-directional, binary min-heap)
// Ported verbatim from Claw3D navigation.ts.
// ---------------------------------------------------------------------------
export function astar(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  grid: NavGrid,
): { x: number; y: number }[] {
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));
  const toCell = (x: number, y: number) => ({
    c: clamp(Math.floor(x / GRID_CELL), 0, GRID_COLS - 1),
    r: clamp(Math.floor(y / GRID_CELL), 0, GRID_ROWS - 1),
  });
  const cellCx = (col: number) => col * GRID_CELL + GRID_CELL / 2;
  const cellCy = (row: number) => row * GRID_CELL + GRID_CELL / 2;

  const findFree = (col: number, row: number) => {
    if (!grid[row * GRID_COLS + col]) return { c: col, r: row };
    for (let d = 1; d < 10; d += 1) {
      for (let dr = -d; dr <= d; dr += 1) {
        for (let dc = -d; dc <= d; dc += 1) {
          if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
          const nr = row + dr, nc = col + dc;
          if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;
          if (!grid[nr * GRID_COLS + nc]) return { c: nc, r: nr };
        }
      }
    }
    return null;
  };

  let { c: sc, r: sr } = toCell(sx, sy);
  let { c: ec, r: er } = toCell(ex, ey);
  const startFree = findFree(sc, sr);
  const endFree = findFree(ec, er);
  if (!startFree || !endFree) return [];
  sc = startFree.c; sr = startFree.r;
  ec = endFree.c;   er = endFree.r;
  if (sc === ec && sr === er) return [{ x: ex, y: ey }];

  const nodeCount = GRID_COLS * GRID_ROWS;
  const gCost = new Float32Array(nodeCount).fill(Infinity);
  const parent = new Int32Array(nodeCount).fill(-1);
  const visited = new Uint8Array(nodeCount);
  const startIdx = sr * GRID_COLS + sc;
  const endIdx = er * GRID_COLS + ec;
  gCost[startIdx] = 0;

  const open: [number, number][] = [];
  const pushOpen = (entry: [number, number]) => {
    open.push(entry);
    let i = open.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (open[p][1] <= entry[1]) break;
      open[i] = open[p];
      i = p;
    }
    open[i] = entry;
  };
  const popOpen = (): [number, number] | null => {
    if (!open.length) return null;
    const first = open[0];
    const last = open.pop();
    if (!last || !open.length) return first;
    let i = 0;
    while (true) {
      const l = i * 2 + 1, ri = l + 1;
      if (l >= open.length) break;
      let s = l;
      if (ri < open.length && open[ri][1] < open[l][1]) s = ri;
      if (open[s][1] >= last[1]) break;
      open[i] = open[s];
      i = s;
    }
    open[i] = last;
    return first;
  };

  pushOpen([startIdx, Math.hypot(ec - sc, er - sr)]);
  const dirs: [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
  ];

  while (open.length) {
    const nxt = popOpen();
    if (!nxt) break;
    const [cur] = nxt;
    if (visited[cur]) continue;
    visited[cur] = 1;
    if (cur === endIdx) {
      const path: { x: number; y: number }[] = [];
      let node = cur;
      while (node !== startIdx) {
        path.push({ x: cellCx(node % GRID_COLS), y: cellCy(Math.floor(node / GRID_COLS)) });
        node = parent[node];
      }
      path.reverse();
      if (path.length) path[path.length - 1] = { x: ex, y: ey };
      else path.push({ x: ex, y: ey });
      return path;
    }
    const cc = cur % GRID_COLS, cr = Math.floor(cur / GRID_COLS);
    for (const [dc, dr, cost] of dirs) {
      const nc = cc + dc, nr = cr + dr;
      if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS) continue;
      const ni = nr * GRID_COLS + nc;
      if (visited[ni] || grid[ni]) continue;
      if (dc !== 0 && dr !== 0) {
        const orthoA = (cr + dr) * GRID_COLS + cc;
        const orthoB = cr * GRID_COLS + (cc + dc);
        if (grid[orthoA] || grid[orthoB]) continue;
      }
      const ng = gCost[cur] + cost;
      if (ng < gCost[ni]) {
        gCost[ni] = ng;
        parent[ni] = cur;
        pushOpen([ni, ng + Math.hypot(ec - nc, er - nr)]);
      }
    }
  }
  return [];
}
