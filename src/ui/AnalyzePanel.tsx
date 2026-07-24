import { useEffect, useMemo, useRef } from "react";
import type { AnalyzeInstruction, HistogramResult, Hit } from "../core/types";
import { conditionLabel } from "./format";
import { SCREEN_Y_RANGE } from "./useExperimentPlayer";

interface AnalyzePanelProps {
  readonly histogram: HistogramResult;
  readonly hits: readonly Hit[];
  readonly revealed: number;
  readonly focused: boolean;
  readonly onClick: () => void;
}

const NUM_COLS = 64;
const CANVAS_W = 560;
const CANVAS_H = 168;
const POINT_PX = 3;

function matchesConditions(hit: Hit, instr: AnalyzeInstruction): boolean {
  return instr.conditions.every((c) => hit.legOutcomes[c.leg] === c.outcome);
}

export function AnalyzePanel({ histogram, hits, revealed, focused, onClick }: AnalyzePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const filteredHits = useMemo(
    () => hits.slice(0, revealed).filter((h) => matchesConditions(h, histogram.instruction)),
    [hits, revealed, histogram.instruction],
  );

  const columnCounts = useMemo(() => {
    const counts = new Array<number>(NUM_COLS).fill(0);
    const { min, max } = SCREEN_Y_RANGE;
    for (const hit of filteredHits) {
      const t = (hit.screenY - min) / (max - min);
      const col = Math.min(NUM_COLS - 1, Math.max(0, Math.floor(t * NUM_COLS)));
      counts[col] = (counts[col] ?? 0) + 1;
    }
    return counts;
  }, [filteredHits]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const { min: yMin, max: yMax } = SCREEN_Y_RANGE;

    // baseline + y=0 tick
    ctx.strokeStyle = "rgba(57,255,136,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H - 0.5);
    ctx.lineTo(CANVAS_W, CANVAS_H - 0.5);
    ctx.stroke();
    const centerX = ((0 - yMin) / (yMax - yMin)) * CANVAS_W;
    ctx.strokeStyle = "rgba(57,255,136,0.12)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, CANVAS_H);
    ctx.stroke();
    ctx.setLineDash([]);

    // analytic density curve (the exact many-round limit)
    const maxDensity = Math.max(...histogram.bins.map((b) => b.density), 1e-9);
    const curveY = (density: number): number =>
      CANVAS_H - (density / maxDensity) * CANVAS_H * 0.9;

    ctx.beginPath();
    histogram.bins.forEach((b, i) => {
      const x = ((b.y - yMin) / (yMax - yMin)) * CANVAS_W;
      const y = curveY(b.density);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.lineTo(0, CANVAS_H);
    ctx.closePath();
    ctx.fillStyle = "rgba(57,255,136,0.08)";
    ctx.fill();

    ctx.beginPath();
    histogram.bins.forEach((b, i) => {
      const x = ((b.y - yMin) / (yMax - yMin)) * CANVAS_W;
      const y = curveY(b.density);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "rgba(57,255,136,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Monte Carlo buildup: stacked squares per column, phosphor-dot style.
    const colWidth = CANVAS_W / NUM_COLS;
    ctx.fillStyle = "#39ff88";
    columnCounts.forEach((count, i) => {
      const h = Math.min(count * POINT_PX, CANVAS_H - 1);
      ctx.fillRect(i * colWidth, CANVAS_H - h, Math.max(1, colWidth - 1), h);
    });
  }, [histogram, columnCounts]);

  return (
    <div
      className={focused ? "analyze-panel analyze-panel--focused" : "analyze-panel"}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <div className="analyze-panel__header">
        <span className="analyze-panel__expr">{conditionLabel(histogram.instruction)}</span>
        {histogram.instruction.comment && (
          <span className="analyze-panel__comment">// {histogram.instruction.comment}</span>
        )}
        <span className="analyze-panel__hint">
          {focused ? "● showing in apparatus" : "click to view in apparatus"}
        </span>
      </div>
      <canvas ref={canvasRef} className="analyze-panel__canvas" />
      <div className="analyze-panel__readout">
        <span>
          N=<b>{filteredHits.length}</b>
        </span>
        <span>
          P(cond)=<b>{(histogram.conditionProbability * 100).toFixed(1)}%</b>
        </span>
        <span>
          V=<b>{histogram.visibility.toFixed(3)}</b>
        </span>
        <span className={histogram.visibility > 0.3 ? "tag tag--fringe" : "tag tag--nofringe"}>
          {histogram.visibility > 0.3 ? "FRINGE" : "NO FRINGE"}
        </span>
      </div>
    </div>
  );
}
