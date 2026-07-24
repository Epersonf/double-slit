import { useEffect, useRef, useState } from "react";
import { slitPositions } from "../core/physics";
import { comboProfileForHit } from "../core/simulate";
import type { CompiledProgram } from "../core/simulate";
import type { Hit } from "../core/types";
import { formatTheta } from "./format";
import { BUILDUP_Y_RANGE } from "./useBuildup";

interface ExperimentStageProps {
  readonly compiled: CompiledProgram | null;
  readonly hits: readonly Hit[];
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
const PARTNER_FLASH_AT = 0.25;
const PARTNER_FLASH_MS = 260;

function mapY(physicsY: number): number {
  const { max } = BUILDUP_Y_RANGE;
  return CENTER_Y - (physicsY / max) * HALF_SPAN;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function flightDuration(speed: number): number {
  return Math.max(260, FLIGHT_DURATION_BASE - speed * 50);
}

interface Flight {
  readonly hit: Hit;
  readonly start: number;
  readonly duration: number;
  readonly slitProbabilities: readonly number[];
  readonly distinguishability: number;
  readonly dominantSlit: number;
  partnerFlashed: boolean;
}

interface AnalyzerBox {
  readonly legName: string;
  readonly basisLabel: string;
  readonly x: number;
  readonly y: number;
  plusCount: number;
  minusCount: number;
  flashUntil: number;
  flashOutcome: 1 | -1;
}

interface StageState {
  flights: Flight[];
  emitted: number;
  lastSpawn: number;
  landedCounts: number[];
  boxes: AnalyzerBox[];
}

function makeStageState(compiled: CompiledProgram | null): StageState {
  const boxes: AnalyzerBox[] = compiled
    ? compiled.nonSignalLegs
        .filter((idx) => compiled.legWithMeas.has(idx))
        .map((idx, i) => {
          const meas = compiled.legWithMeas.get(idx);
          return {
            legName: compiled.legNames[idx] ?? `leg${idx + 1}`,
            basisLabel: meas ? formatTheta(meas.basisTheta) : "?",
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
    emitted: 0,
    lastSpawn: performance.now(),
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
    partnerFlashed: false,
  });
}

function landOn(st: StageState, f: Flight): void {
  const { min, max } = BUILDUP_Y_RANGE;
  const t = (f.hit.screenY - min) / (max - min);
  const bin = Math.min(NUM_SCREEN_BINS - 1, Math.max(0, Math.floor(t * NUM_SCREEN_BINS)));
  st.landedCounts[bin] = (st.landedCounts[bin] ?? 0) + 1;
}

function maybeFlashPartner(st: StageState, f: Flight, progress: number, now: number): void {
  if (f.partnerFlashed || progress < PARTNER_FLASH_AT) return;
  f.partnerFlashed = true;
  for (const box of st.boxes) {
    const outcome = f.hit.legOutcomes[box.legName];
    if (outcome === undefined) continue;
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
  ctx.fillStyle = "#39ff88";
  ctx.beginPath();
  ctx.arc(x, y, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  f: Flight,
  progress: number,
  slitYs: readonly number[],
): void {
  const waviness = 1 - f.distinguishability;
  if (waviness < 0.03) return;

  if (progress <= P_BARRIER) {
    const t = progress / P_BARRIER;
    const x = lerp(SOURCE_X, BARRIER_X, t);
    ctx.globalAlpha = waviness * 0.9;
    ctx.fillStyle = "#39ff88";
    ctx.beginPath();
    ctx.arc(x, CENTER_Y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  const t2 = (progress - P_BARRIER) / (1 - P_BARRIER);
  const maxRadius = (SCREEN_X - BARRIER_X) * 0.95;

  slitYs.forEach((slitY, j) => {
    const weight = f.slitProbabilities[j] ?? 0;
    if (weight < 0.02) return;
    const radius = Math.max(2, t2 * maxRadius);
    const rippleOpacity = waviness * weight * (1 - t2) * 1.6;
    if (rippleOpacity <= 0.02) return;
    ctx.globalAlpha = Math.min(1, rippleOpacity);
    ctx.strokeStyle = "#39ff88";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(BARRIER_X, slitY, radius, -0.95, 0.95);
    ctx.stroke();
  });

  const landOpacity = waviness * Math.max(0, (t2 - 0.55) / 0.45);
  if (landOpacity > 0.03) {
    const x = lerp(BARRIER_X, SCREEN_X, t2);
    const y = lerp(CENTER_Y, mapY(f.hit.screenY), t2);
    ctx.globalAlpha = Math.min(1, landOpacity);
    ctx.fillStyle = "#39ff88";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.fillText(`${box.legName} θ=${box.basisLabel}`, box.x, box.y - 3);
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

export function ExperimentStage({ compiled, hits }: ExperimentStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [speed, setSpeed] = useState(3);
  const [playing, setPlaying] = useState(true);
  const [launched, setLaunched] = useState(0);

  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const stateRef = useRef<StageState>(makeStageState(compiled));

  // Resetting stateRef here (inside the effect) is fine — it's the setState
  // call that must not happen synchronously in an effect body. The `launched`
  // readout is instead corrected from inside the rAF callback below (frame 0),
  // which is an async callback, not the effect body itself.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    stateRef.current = makeStageState(compiled);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = STAGE_W * dpr;
    canvas.height = STAGE_H * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    let raf = 0;
    let frame = 0;

    const tick = (now: number): void => {
      const st = stateRef.current;

      if (playingRef.current && compiled) {
        const interval = 1000 / Math.max(0.1, speedRef.current);
        while (now - st.lastSpawn >= interval && st.emitted < hits.length) {
          spawn(st, hits[st.emitted]!, compiled, now, flightDuration(speedRef.current));
          st.emitted++;
          st.lastSpawn += interval;
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

      if (frame === 0 || frame % 6 === 0) setLaunched(st.emitted);
      frame++;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [compiled, hits]);

  const total = hits.length;

  return (
    <div className="stage">
      <div className="stage__header">
        <span className="stage__title">EXPERIMENT — live apparatus</span>
        <span className="stage__count">
          launched: <b>{launched}</b> / {total}
        </span>
      </div>
      <canvas ref={canvasRef} className="stage__canvas" />
      <div className="stage__controls">
        <button type="button" className="stage__btn" onClick={() => setPlaying((p) => !p)}>
          {playing ? "❚❚ PAUSE" : "▶ PLAY"}
        </button>
        <button
          type="button"
          className="stage__btn"
          onClick={() => {
            const st = stateRef.current;
            if (compiled && st.emitted < hits.length) {
              const now = performance.now();
              spawn(st, hits[st.emitted]!, compiled, now, flightDuration(speed));
              st.emitted++;
              st.lastSpawn = now;
              setLaunched(st.emitted);
            }
          }}
        >
          ⇥ STEP
        </button>
        <label className="stage__speed">
          SPEED
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span>{speed.toFixed(1)}/s</span>
        </label>
      </div>
      <p className="stage__caption">
        The entangled partner is measured first (flash at its analyzer). If that
        reveals which slit the signal took, it lands as a particle through a single
        slit; if the information is erased, it travels as an interfering wave
        through both.
      </p>
    </div>
  );
}
