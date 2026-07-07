"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, Button, SkeletonCard } from "@/components/ui";
import { useSettings, useSeats } from "@/lib/store";
import { hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
import type { AgentSeat } from "@/lib/types";
import { Folder, File, ArrowUp, Server } from "lucide-react";

interface FileEntry {
  name: string;
  is_directory: boolean;
  size?: number;
  modified_at?: string;
}

interface FileList {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

/** Demo-mode file tree — a small synthetic directory of the kind the Aria
 *  curator manages (per-agent persona/session files, nightly memory
 *  snapshots), scoped with real agent names so the page never dead-ends
 *  into a bare "enable live mode" stub. Not real files on disk. */
function buildDemoTree(seats: AgentSeat[]): Record<string, FileEntry[]> {
  const agentFolders: FileEntry[] = (seats.length > 0 ? seats : []).slice(0, 8).map((s) => ({
    name: s.name.toLowerCase().replace(/\s+/g, "-"),
    is_directory: true,
  }));
  const tree: Record<string, FileEntry[]> = {
    "": [
      { name: "agents", is_directory: true },
      { name: "memory-snapshots", is_directory: true },
      { name: "guardrails.json", is_directory: false, size: 2140, modified_at: "2026-06-30T09:12:00Z" },
      { name: "curator.log", is_directory: false, size: 15872, modified_at: "2026-07-01T06:00:00Z" },
    ],
    agents: agentFolders.length > 0 ? agentFolders : [{ name: "no-agents-yet.txt", is_directory: false, size: 0 }],
    "memory-snapshots": [
      { name: "2026-06-29-nightly.json", is_directory: false, size: 49760, modified_at: "2026-06-29T02:00:00Z" },
      { name: "2026-06-30-nightly.json", is_directory: false, size: 50340, modified_at: "2026-06-30T02:00:00Z" },
      { name: "2026-07-01-nightly.json", is_directory: false, size: 51120, modified_at: "2026-07-01T02:00:00Z" },
    ],
  };
  for (const folder of agentFolders) {
    tree[`agents/${folder.name}`] = [
      { name: "persona.md", is_directory: false, size: 640, modified_at: "2026-06-25T10:00:00Z" },
      { name: "session-log.jsonl", is_directory: false, size: 12980, modified_at: "2026-07-01T08:30:00Z" },
    ];
  }
  return tree;
}

/** null = at root (no Up button), "" = root path, otherwise the parent segment. */
function parentPath(path: string): string | null {
  if (!path) return null;
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function FileEntries({ listing, onNavigate }: { listing: FileList; onNavigate: (path: string) => void }) {
  if (listing.entries.length === 0) {
    return <p className="text-xs text-muted">No files at this path.</p>;
  }
  return (
    <ul className="space-y-1">
      {listing.entries.map((entry) => (
        <li key={entry.name}>
          <button
            type="button"
            onClick={() => entry.is_directory && onNavigate(`${listing.path}/${entry.name}`.replace(/^\//, ""))}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs hover:bg-canvas"
          >
            {entry.is_directory ? (
              <Folder className="h-4 w-4 text-warning" aria-hidden />
            ) : (
              <File className="h-4 w-4 text-electric" aria-hidden />
            )}
            <span className="flex-1 truncate text-ink">{entry.name}</span>
            {typeof entry.size === "number" && (
              <span className="text-[10px] text-muted tabular-nums">{entry.size} B</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FileBrowser() {
  const settings = useSettings();
  const seats = useSeats();
  const live = hermesRuntimeAvailable(settings);
  const demoTree = React.useMemo(() => buildDemoTree(seats), [seats]);
  const [path, setPath] = React.useState<string | undefined>(undefined);
  const [listing, setListing] = React.useState<FileList | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!live) {
      setListing(null);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set("upstreamPath", "api/files");
    if (path) params.set("path", path);
    if (settings.hermesApiKeyId) params.set("hermesApiKeyId", settings.hermesApiKeyId);
    fetch(`/api/hermes/proxy?${params.toString()}`)
      .then(async (res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as FileList | null;
        if (data) setListing(data);
        else setError(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [live, path, settings]);

  if (!live) {
    const demoListing: FileList = {
      path: path ?? "",
      parent: parentPath(path ?? ""),
      entries: demoTree[path ?? ""] ?? [],
    };
    return (
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Eyebrow className="flex items-center gap-1.5">
              <Server className="h-3 w-3" aria-hidden /> Aria files
            </Eyebrow>
            <Badge tone="warning" size="sm">Demo</Badge>
          </div>
          {demoListing.parent !== null && (
            <Button
              size="sm"
              variant="outline"
              leftIcon={<ArrowUp className="h-3.5 w-3.5" />}
              onClick={() => setPath(demoListing.parent ?? undefined)}
            >
              Up
            </Button>
          )}
          <FileEntries listing={demoListing} onNavigate={setPath} />
          <p className="text-xs text-muted">
            Preview only — enable Aria live mode in Settings to browse the real runtime file tree.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria files
          </Eyebrow>
          <Badge tone="success" size="sm" dot>Live</Badge>
        </div>
        {listing?.parent && (
          <Button size="sm" variant="outline" leftIcon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => setPath(listing.parent ?? undefined)}>
            Up
          </Button>
        )}
        {loading ? (
          <SkeletonCard />
        ) : error ? (
          <p className="text-xs text-muted">Could not reach the Aria runtime.</p>
        ) : !listing ? (
          <p className="text-xs text-muted">No files at this path.</p>
        ) : (
          <FileEntries listing={listing} onNavigate={setPath} />
        )}
      </CardContent>
    </Card>
  );
}
