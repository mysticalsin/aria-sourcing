"use client";

import * as React from "react";
import { Suspense } from "react";
import { Box } from "lucide-react";
import RetroOfficeScene from "./retro/RetroOfficeScene";
import type { OfficeAgent } from "./types";

/* ============================================================================
   Client wrapper for the 3D floor. Sizes the canvas container and provides a
   Suspense boundary while GLBs / fonts stream in. The floor page imports this
   via next/dynamic({ ssr: false }).

   Feature-detects WebGL before mounting the scene: on devices/browsers without
   a usable WebGL context the three.js renderer throws on init, which would
   crash the floor page. Instead we render a graceful fallback that points the
   operator at the 2D grid view.
   ========================================================================== */

interface Floor3DProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Optional replacement agent list (e.g. /replay's derived history
   *  reconstruction). When provided, the scene renders these INSTEAD of
   *  `agents` — everything else (WebGL detection, the Suspense boundary, the
   *  context-loss guard) is unchanged either way. Undefined (the default)
   *  keeps this component byte-for-byte identical to before this prop existed. */
  agentsOverride?: OfficeAgent[];
}

/** True when a WebGL rendering context can actually be created. */
function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.WebGLRenderingContext === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return gl != null;
  } catch {
    return false;
  }
}

function WebGLFallback({
  title,
  message,
}: {
  title: string;
  message: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Box className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm text-muted">{message}</p>
    </div>
  );
}

export default function Floor3D({ agents, selectedId, onSelect, agentsOverride }: Floor3DProps) {
  // Source-of-agents swap only — everything below is unchanged regardless of
  // which list this resolves to.
  const activeAgents = agentsOverride ?? agents;
  // null = not yet checked (avoids mounting the scene during the first paint
  // before we know WebGL is available).
  const [webglOk, setWebglOk] = React.useState<boolean | null>(null);
  // True while the GPU has dropped the canvas's WebGL context (driver reset,
  // GPU crash, tab backgrounded on a low-memory device). Without a guard the
  // three.js render loop keeps failing off-screen and the tab eventually
  // white-screens outside React's error boundary.
  const [contextLost, setContextLost] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);

  React.useEffect(() => {
    if (webglOk !== true) return;
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    const handleContextLost = (event: Event) => {
      // preventDefault() asks the browser to attempt automatic restoration
      // instead of treating the loss as terminal.
      event.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => setContextLost(false);

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    };
  }, [webglOk]);

  return (
    <div
      ref={containerRef}
      className="relative h-[70vh] w-full overflow-hidden rounded-2xl border border-line bg-canvas"
    >
      {webglOk === false ? (
        <WebGLFallback
          title="3D floor unavailable"
          message={
            <>
              Your browser or device doesn&apos;t support WebGL, so the 3D office
              can&apos;t render. Switch to the <strong>2D grid</strong> view above to
              see your fleet.
            </>
          }
        />
      ) : webglOk === null ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          Loading 3D floor…
        </div>
      ) : (
        <>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Loading 3D floor…
              </div>
            }
          >
            <RetroOfficeScene
              agents={activeAgents}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </Suspense>
          {contextLost ? (
            <div className="absolute inset-0 bg-canvas">
              <WebGLFallback
                title="3D view unavailable"
                message="The 3D renderer lost its graphics context and is trying to recover. If this doesn't clear up, refresh the page or switch to the 2D grid view."
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
