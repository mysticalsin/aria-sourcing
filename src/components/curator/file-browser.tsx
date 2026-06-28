"use client";

import * as React from "react";
import { Card, CardContent, Eyebrow, Badge, Button, SkeletonCard } from "@/components/ui";
import { useSettings } from "@/lib/store";
import { hermesRuntimeAvailable } from "@/lib/ai/hermes-runtime";
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

export function FileBrowser() {
  const settings = useSettings();
  const live = hermesRuntimeAvailable(settings);
  const [path, setPath] = React.useState<string | undefined>(undefined);
  const [listing, setListing] = React.useState<FileList | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!live) {
      setListing(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("upstreamPath", "api/files");
    if (path) params.set("path", path);
    if (settings.hermesApiKeyId) params.set("hermesApiKeyId", settings.hermesApiKeyId);
    fetch(`/api/hermes/proxy?${params.toString()}`).then(async (res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as FileList | null;
      if (data) setListing(data);
    });
    return () => {
      cancelled = true;
    };
  }, [live, path, settings]);

  if (!live) {
    return (
      <Card>
        <CardContent className="space-y-2">
          <Eyebrow className="flex items-center gap-1.5">
            <Server className="h-3 w-3" aria-hidden /> Aria files
          </Eyebrow>
          <p className="text-xs text-muted">
            Enable Aria live mode in Settings to browse managed files on the runtime.
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
        ) : !listing || listing.entries.length === 0 ? (
          <p className="text-xs text-muted">No files at this path.</p>
        ) : (
          <ul className="space-y-1">
            {listing.entries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  onClick={() => entry.is_directory && setPath(`${listing.path}/${entry.name}`.replace(/^\//, ""))}
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
        )}
      </CardContent>
    </Card>
  );
}
