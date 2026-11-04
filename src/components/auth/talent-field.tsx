"use client";

import * as React from "react";

/** The login panel's one moment: a field of profiles, a single sweep that
 *  lights the ones matching the brief, then five threads converging on the
 *  human approval node. Plays once (about 4 s) and stays still afterwards;
 *  reduced motion draws the final frame directly. Decorative: the steps next
 *  to it carry the meaning for assistive technology. */

const SPACING = 26;
const DURATION = 4200;
const SHORTLIST = 5;

type Dot = { x: number; y: number; delay: number; match: boolean; pick: boolean };

/** Deterministic pseudo-random, so the field is the same on every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);

function cssColor(name: string, alpha = 1) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return `hsl(${value} / ${alpha})`;
}

function layout(width: number, height: number, node: { x: number; y: number }): Dot[] {
  const random = rng(7);
  const dots: Dot[] = [];
  for (let y = SPACING / 2; y < height; y += SPACING) {
    for (let x = SPACING / 2; x < width; x += SPACING) {
      const px = x + (random() - 0.5) * SPACING * 0.7;
      const py = y + (random() - 0.5) * SPACING * 0.7;
      dots.push({ x: px, y: py, delay: (px / width) * 0.35 + random() * 0.15, match: random() < 0.05, pick: false });
    }
  }
  // The shortlist: matches spread across the upper field, so the threads
  // visibly gather from everywhere rather than from the node's neighbours.
  const candidates = dots
    .filter((d) => d.match && Math.hypot(d.x - node.x, d.y - node.y) > width * 0.2 && d.y < height * 0.5)
    .sort((a, b) => a.x - b.x);
  for (let i = 0; i < SHORTLIST && candidates.length > 0; i++) {
    candidates[Math.floor(((i + 0.5) / SHORTLIST) * candidates.length)].pick = true;
  }
  return dots;
}

export function TalentField({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const colors = {
      dot: cssColor("--paper", 0.16),
      match: cssColor("--violet", 0.95),
      matchHalo: cssColor("--violet", 0.18),
      sweep: cssColor("--violet", 0.22),
      thread: cssColor("--mantu-yellow", 0.55),
      node: cssColor("--mantu-yellow"),
      nodeHalo: cssColor("--mantu-yellow", 0.2),
      label: cssColor("--paper", 0.85),
    };
    let width = 0;
    let height = 0;
    let node = { x: 0, y: 0 };
    let dots: Dot[] = [];
    let frame = 0;
    let start = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      node = { x: width * 0.7, y: height * 0.3 };
      dots = layout(width, height, node);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      const sweepX = ease((t - 0.12) / 0.45) * (width + 120) - 60;
      const threads = ease((t - 0.6) / 0.28);
      const nodeIn = ease((t - 0.82) / 0.18);

      if (t > 0.12 && t < 0.62) {
        const band = ctx.createLinearGradient(sweepX - 90, 0, sweepX + 4, 0);
        band.addColorStop(0, "transparent");
        band.addColorStop(1, colors.sweep);
        ctx.fillStyle = band;
        ctx.fillRect(sweepX - 90, 0, 94, height);
      }

      for (const d of dots) {
        const appear = ease((t - d.delay * 0.3) / 0.2);
        if (appear <= 0) continue;
        const lit = d.match && d.x < sweepX ? ease((sweepX - d.x) / 80) : 0;
        if (lit > 0) {
          ctx.fillStyle = colors.matchHalo;
          ctx.beginPath();
          ctx.arc(d.x, d.y, 2 + lit * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = d.pick && threads >= 1 ? colors.node : lit > 0 ? colors.match : colors.dot;
        ctx.globalAlpha = lit > 0 ? 1 : appear;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.3 + lit * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (threads > 0) {
        ctx.strokeStyle = colors.thread;
        ctx.lineWidth = 1;
        for (const d of dots) {
          if (!d.pick) continue;
          // A gentle bow off the straight line reads as a path, not a chart line.
          const cx = (d.x + node.x) / 2 + (node.y - d.y) * 0.18;
          const cy = (d.y + node.y) / 2 - (node.x - d.x) * 0.18;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          const steps = 24;
          for (let i = 1; i <= Math.round(steps * threads); i++) {
            const u = i / steps;
            const x = (1 - u) * (1 - u) * d.x + 2 * (1 - u) * u * cx + u * u * node.x;
            const y = (1 - u) * (1 - u) * d.y + 2 * (1 - u) * u * cy + u * u * node.y;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      if (nodeIn > 0) {
        ctx.fillStyle = colors.nodeHalo;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 10 + nodeIn * 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors.node;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 6 * nodeIn, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = nodeIn;
        ctx.fillStyle = colors.label;
        ctx.font = `600 13px ${getComputedStyle(document.body).fontFamily}`;
        ctx.fillText("You approve", node.x + 22, node.y + 4.5);
        ctx.globalAlpha = 1;
      }
    };

    const tick = (now: number) => {
      start ||= now;
      const t = Math.min(1, (now - start) / DURATION);
      draw(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    resize();
    if (reduced) draw(1);
    else frame = requestAnimationFrame(tick);

    // Redraw the settled frame on resize; the sequence never replays.
    const observer = new ResizeObserver(() => {
      const playing = start && performance.now() - start < DURATION;
      resize();
      if (!playing) draw(1);
    });
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
