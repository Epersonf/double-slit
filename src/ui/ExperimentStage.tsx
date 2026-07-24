import { useEffect, useRef } from "react";
import { slitPositions } from "../core/physics";
import { comboProfileForHit } from "../core/simulate";
import type { CompiledProgram } from "../core/simulate";
import type { Condition, Hit } from "../core/types";
import { formatTheta } from "./format";
import { SCREEN_Y_RANGE } from "./useExperimentPlayer";

interface ExperimentStageProps {
  readonly compiled: CompiledProgram | null;
  readonly hits: readonly Hit[];
  /** How many of `hits` are "live" — the single shared clock (useExperimentPlayer)
   * that also drives the ROUNDS panel and every ANALYZE panel's buildup. The stage
   * never paces itself independently: it only animates whichever hits just became
   * revealed, so it can never drift out of sync with the rest of the app. */
  readonly revealed: number;
  readonly speed: number;
  readonly playing: boolean;
  readonly onTogglePlay: () => void;
  readonly onStep: () => void;
  readonly onSpeedChange: (speed: number) => void;
  /** When set (by clicking an ANALYZE panel), only rounds matching these
   * conditions are animated/landed — the same underlying stream, filtered down
   * to one screen's worth of rounds instead of the marginal mixture. */
  readonly focusConditions: readonly Condition[] | null;
  readonly focusLabel: string;
  readonly onClearFocus: () => void;
}

const STAGE_W = 960;
const STAGE_H = 260;
const SOURCE_X = 60;
const BARRIER_X = 420;
const SCREEN_X = 900;
const P_BARRIER = (BARRIER_X - SOURCE_X) / (SCREEN_X - SOURCE_X);
const CENTER_Y = STAGE_H / 2;
const HALF_SPAN = STAGE_H / 2 - 30;
const NUM_SCREEN_BINS = 52;
const FLIGHT_DURATION_BASE = 900;
const FLASH_AT_BEFORE = 0.18;
const FLASH_AT_AFTER = 0.94;
const PARTNER_FLASH_MS = 260;
const MAX_SPAWNS_PER_FRAME = 40;

function mapY(physicsY: number): number {
  const { max } = SCREEN_Y_RANGE;
  return CENTER_Y - (physicsY / max) * HALF_SPAN;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function flightDuration(speed: number): number {
  return Math.max(260, FLIGHT_DURATION_BASE - speed * 50);
}

function matchesFocus(hit: Hit, focus: readonly Condition[] | null): boolean {
  if (!focus) return true;
  return focus.every((c) => hit.legOutcomes[c.leg] === c.outcome);
}

interface Flight {
  readonly hit: Hit;
  readonly start: number;
  readonly duration: number;
  readonly slitProbabilities: readonly number[];
  readonly distinguishability: number;
  readonly dominantSlit: number;
  readonly flashedLegs: Set<string>;
}

interface AnalyzerBox {
  readonly legName: string;
  readonly basisLabel: string;
  /** Flight progress (0..1) at which this leg's measurement is revealed —
   * "before" fires early (near the source), "after" fires near the screen,
   * visualizing that the choice/order doesn't change the statistics. */
  readonly flashAtProgress: number;
  readonly timingLabel: string;
  readonly x: number;
  readonly y: number;
  plusCount: number;
  minusCount: number;
  flashUntil: number;
  flashOutcome: 1 | -1;
}

interface StageState {
  flights: Flight[];
  spawned: number;
  landedCounts: number[];
  boxes: AnalyzerBox[];
}

function makeStageState(compiled: CompiledProgram | null): StageState {
  const boxes: AnalyzerBox[] = compiled
    ? compiled.nonSignalLegs
        .filter((idx) => compiled.legWithMeas.has(idx))
        .map((idx, i) => {
          const meas = compiled.legWithMeas.get(idx);
          // Only "after" gets a distinct (late) flash timing and an explicit
          // label — an unspecified `time=` isn't the same as the program
          // asserting "before", so it must not be displayed as if it were.
          const timing = meas?.timing;
          return {
            legName: compiled.legNames[idx] ?? `leg${idx + 1}`,
            basisLabel: meas ? formatTheta(meas.basisTheta) : "?",
            flashAtProgress: timing === "after" ? FLASH_AT_AFTER : FLASH_AT_BEFORE,
            timingLabel: timing ?? "",
            x: SOURCE_X + 90 + i * 110,
            y: STAGE_H - 30,
            plusCount: 0,
            minusCount: 0,
            flashUntil: 0,
            flashOutcome: 1,
          };
        })
    : [];
  return {
    flights: [],
    spawned: 0,
    landedCounts: new Array(NUM_SCREEN_BINS).fill(0),
    boxes,
  };
}

function spawn(st: StageState, hit: Hit, compiled: CompiledProgram, now: number, duration: number): void {
  const profile = comboProfileForHit(compiled, hit);
  let dominantSlit = 0;
  profile.slitProbabilities.forEach((p, i) => {
    if (p > (profile.slitProbabilities[dominantSlit] ?? 0)) dominantSlit = i;
  });
  st.flights.push({
    hit,
    start: now,
    duration,
    slitProbabilities: profile.slitProbabilities,
    distinguishability: profile.distinguishability,
    dominantSlit,
    flashedLegs: new Set(),
  });
}

function landOn(st: StageState, f: Flight): void {
  const { min, max } = SCREEN_Y_RANGE;
  const t = (f.hit.screenY - min) / (max - min);
  const bin = Math.min(NUM_SCREEN_BINS - 1, Math.max(0, Math.floor(t * NUM_SCREEN_BINS)));
  st.landedCounts[bin] = (st.landedCounts[bin] ?? 0) + 1;
}

function maybeFlashPartner(st: StageState, f: Flight, progress: number, now: number): void {
  for (const box of st.boxes) {
    if (f.flashedLegs.has(box.legName) || progress < box.flashAtProgress) continue;
    const outcome = f.hit.legOutcomes[box.legName];
    if (outcome === undefined) continue;
    f.flashedLegs.add(box.legName);
    if (outcome === 1) box.plusCount++;
    else box.minusCount++;
    box.flashUntil = now + PARTNER_FLASH_MS;
    box.flashOutcome = outcome;
  }
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  f: Flight,
  progress: number,
  slitYs: readonly number[],
): void {
  const alpha = f.distinguishability;
  if (alpha < 0.03) return;
  const slitY = slitYs[f.dominantSlit] ?? CENTER_Y;
  let x: number;
  let y: number;
  if (progress <= P_BARRIER) {
    const t = progress / P_BARRIER;
    x = lerp(SOURCE_X, BARRIER_X, t);
    y = lerp(CENTER_Y, slitY, t);
  } else {
    const t = (progress - P_BARRIER) / (1 - P_BARRIER);
    x = lerp(BARRIER_X, SCREEN_X, t);
    y = lerp(slitY, mapY(f.hit.screenY), t);
  }
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.shadowColor = "#39ff88";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#39ff88";
  ctx.beginPath();
  ctx.arc(x, y, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/** Wave rendering is the whole point of this stage — it must read clearly even at
 * a glance. Glow (shadowBlur) + two trailing wavefronts per slit + a bright,
 * slowly-fading pulse (instead of fading in step with 1-t2) keep it legible the
 * entire flight instead of only in a brief window right after the barrier. */
function drawWave(
  ctx: CanvasRenderingContext2D,
  f: Flight,
  progress: number,
  slitYs: readonly number[],
): void {
  const waviness = 1 - f.distinguishability;
  if (waviness < 0.03) return;

  ctx.shadowColor = "#39ff88";

  if (progress <= P_BARRIER) {
    const t = progress / P_BARRIER;
    const x = lerp(SOURCE_X, BARRIER_X, t);
    const pulse = 3 + Math.sin(t * Math.PI * 3) * 1.5;
    ctx.globalAlpha = waviness;
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#8dffb8";
    ctx.beginPath();
    ctx.arc(x, CENTER_Y, Math.max(2, pulse), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    return;
  }

  const t2 = (progress - P_BARRIER) / (1 - P_BARRIER);
  const maxRadius = (SCREEN_X - BARRIER_X) * 0.95;
  const fade = Math.max(0, 1 - t2 * 0.75);

  slitYs.forEach((slitY, j) => {
    const weight = f.slitProbabilities[j] ?? 0;
    if (weight < 0.02) return;
    const leadRadius = Math.max(2, t2 * maxRadius);
    const rings = [
      { radius: leadRadius, opacity: 1 },
      { radius: Math.max(2, leadRadius - 22), opacity: 0.55 },
    ];
    for (const ring of rings) {
      const rippleOpacity = waviness * weight * fade * ring.opacity * 2.2;
      if (rippleOpacity <= 0.03) continue;
      ctx.globalAlpha = Math.min(1, rippleOpacity);
      ctx.shadowBlur = 8;
      ctx.strokeStyle = "#39ff88";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(BARRIER_X, slitY, ring.radius, -1.05, 1.05);
      ctx.stroke();
    }
  });
  ctx.shadowBlur = 0;

  const landOpacity = waviness * Math.max(0, (t2 - 0.5) / 0.5);
  if (landOpacity > 0.03) {
    const x = lerp(BARRIER_X, SCREEN_X, t2);
    const y = lerp(CENTER_Y, mapY(f.hit.screenY), t2);
    ctx.globalAlpha = Math.min(1, landOpacity);
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#8dffb8";
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function draw(
  ctx: CanvasRenderingContext2D,
  st: StageState,
  compiled: CompiledProgram | null,
  now: number,
): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);

  ctx.strokeStyle = "rgba(57,255,136,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SOURCE_X, CENTER_Y);
  ctx.lineTo(BARRIER_X, CENTER_Y);
  ctx.stroke();

  ctx.fillStyle = "#39ff88";
  ctx.beginPath();
  ctx.arc(SOURCE_X, CENTER_Y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "10px monospace";
  ctx.fillStyle = "rgba(201,255,216,0.6)";
  ctx.fillText("SRC", SOURCE_X - 12, CENTER_Y - 14);

  if (!compiled) {
    ctx.fillStyle = "rgba(201,255,216,0.4)";
    ctx.font = "13px monospace";
    ctx.fillText("waiting for a valid program...", STAGE_W / 2 - 110, CENTER_Y);
    return;
  }

  const slitYs = slitPositions(compiled.pathInstr.slits, compiled.pathInstr.spacing).map(mapY);

  // barrier with slit gaps
  const gapHalf = 7;
  ctx.strokeStyle = "#ffb02e";
  ctx.lineWidth = 3;
  const sortedGaps = [...slitYs].sort((a, b) => a - b);
  let cursorY = 18;
  for (const gy of sortedGaps) {
    if (gy - gapHalf > cursorY) {
      ctx.beginPath();
      ctx.moveTo(BARRIER_X, cursorY);
      ctx.lineTo(BARRIER_X, gy - gapHalf);
      ctx.stroke();
    }
    cursorY = gy + gapHalf;
  }
  if (cursorY < STAGE_H - 18) {
    ctx.beginPath();
    ctx.moveTo(BARRIER_X, cursorY);
    ctx.lineTo(BARRIER_X, STAGE_H - 18);
    ctx.stroke();
  }

  // screen
  ctx.strokeStyle = "rgba(57,255,136,0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SCREEN_X, 18);
  ctx.lineTo(SCREEN_X, STAGE_H - 18);
  ctx.stroke();

  // accumulated landing histogram, growing rightward off the screen
  const binHeight = (STAGE_H - 36) / NUM_SCREEN_BINS;
  ctx.fillStyle = "#39ff88";
  st.landedCounts.forEach((count, i) => {
    if (count === 0) return;
    const y = 18 + i * binHeight;
    const w = Math.min(count * 2.4, STAGE_W - SCREEN_X - 12);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(SCREEN_X + 3, y, w, Math.max(1, binHeight - 1));
  });
  ctx.globalAlpha = 1;

  // entangled partner: splitter lines + analyzer boxes
  for (const box of st.boxes) {
    ctx.strokeStyle = "rgba(57,255,136,0.15)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(SOURCE_X, CENTER_Y);
    ctx.lineTo(box.x, box.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const flashing = now < box.flashUntil;
    const color = box.flashOutcome === 1 ? "#39ff88" : "#ff6b6b";
    ctx.strokeStyle = flashing ? color : "rgba(127,184,255,0.5)";
    ctx.lineWidth = flashing ? 2 : 1;
    ctx.strokeRect(box.x - 36, box.y - 15, 72, 30);

    ctx.textAlign = "center";
    ctx.font = "9.5px monospace";
    ctx.fillStyle = flashing ? color : "rgba(127,184,255,0.85)";
    const timingSuffix = box.timingLabel ? ` (${box.timingLabel})` : "";
    ctx.fillText(`${box.legName} θ=${box.basisLabel}${timingSuffix}`, box.x, box.y - 3);
    ctx.fillStyle = "rgba(201,255,216,0.55)";
    ctx.fillText(`+${box.plusCount} / -${box.minusCount}`, box.x, box.y + 10);
    ctx.textAlign = "left";
  }

  for (const f of st.flights) {
    const progress = Math.min(1, (now - f.start) / f.duration);
    drawParticle(ctx, f, progress, slitYs);
    drawWave(ctx, f, progress, slitYs);
  }
}

export function ExperimentStage({
  compiled,
  hits,
  revealed,
  speed,
  playing,
  onTogglePlay,
  onStep,
  onSpeedChange,
  focusConditions,
  focusLabel,
  onClearFocus,
}: ExperimentStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<StageState>(makeStageState(compiled));
  const hitsRef = useRef(hits);
  const revealedRef = useRef(revealed);
  const speedRef = useRef(speed);
  const focusRef = useRef(focusConditions);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);
  useEffect(() => {
    hitsRef.current = hits;
  }, [hits]);
  useEffect(() => {
    focusRef.current = focusConditions;
  }, [focusConditions]);

  // Reset the stage whenever the underlying hit batch changes (new program,
  // seed, or round count) — matches the reset useExperimentPlayer itself does.
  // Switching focus does NOT resample anything, just changes which of the same
  // rounds get animated, so it intentionally does not reset spawned/landed.
  useEffect(() => {
    stateRef.current = makeStageState(compiled);
  }, [compiled, hits]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = STAGE_W * dpr;
    canvas.height = STAGE_H * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    let raf = 0;

    const tick = (now: number): void => {
      const st = stateRef.current;
      const currentHits = hitsRef.current;
      const focus = focusRef.current;
      const targetRevealed = Math.min(revealedRef.current, currentHits.length);

      if (compiled) {
        // Non-matching rounds (filtered out by focus) are skipped for free —
        // only actual spawns count against the per-frame budget, so a
        // restrictive focus still catches up instantly instead of visibly
        // lagging behind the shared round counter.
        let spawnBudget = MAX_SPAWNS_PER_FRAME;
        while (st.spawned < targetRevealed && spawnBudget > 0) {
          const hit = currentHits[st.spawned];
          if (!hit) break;
          if (matchesFocus(hit, focus)) {
            spawn(st, hit, compiled, now, flightDuration(speedRef.current));
            spawnBudget--;
          }
          st.spawned++;
        }
      }

      const stillActive: Flight[] = [];
      for (const f of st.flights) {
        const progress = (now - f.start) / f.duration;
        if (progress >= 1) {
          landOn(st, f);
        } else {
          maybeFlashPartner(st, f, progress, now);
          stillActive.push(f);
        }
      }
      st.flights = stillActive;

      draw(ctx, st, compiled, now);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [compiled]);

  const total = hits.length;

  return (
    <div className="stage">
      <div className="stage__header">
        <span className="stage__title">EXPERIMENT — live apparatus</span>
        <span className="stage__count">
          round: <b>{revealed}</b> / {total}
        </span>
      </div>
      <div className="stage__focus">
        showing: <b>{focusLabel}</b>
        {focusConditions !== null && (
          <button type="button" className="stage__focus-clear" onClick={onClearFocus}>
            ✕ show all rounds
          </button>
        )}
      </div>
      <canvas ref={canvasRef} className="stage__canvas" />
      <div className="stage__controls">
        <button type="button" className="stage__btn" onClick={onTogglePlay}>
          {playing ? "❚❚ PAUSE" : "▶ PLAY"}
        </button>
        <button type="button" className="stage__btn" onClick={onStep}>
          ⇥ STEP
        </button>
        <label className="stage__speed">
          SPEED
          <input
            type="range"
            min={0.5}
            max={500}
            step={0.5}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          />
          <span>{speed.toFixed(1)}/s</span>
        </label>
      </div>
      <p className="stage__caption">
        The entangled partner is measured first (flash at its analyzer — "before"
        fires near the source, "after" fires near the screen). If that reveals
        which slit the signal took, it lands as a particle through a single slit;
        if the information is erased, it travels as an interfering wave through
        both. Click any ANALYZE panel below to watch just that subset land here.
      </p>
    </div>
  );
}
