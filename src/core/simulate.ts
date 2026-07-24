import { cartesianBinary, envelope, integrate, linspace, screenAmplitude } from "./physics";
import { buildJointState, rotateLegToMeasBasis, keyOf } from "./states";
import type { JointState } from "./states";
import { Complex } from "./complex";
import { NcieError } from "./types";
import type {
  AnalyzeInstruction,
  Hit,
  HistogramResult,
  Instruction,
  LegInfo,
  MeasInstruction,
  PathInstruction,
  Program,
  SimulationResult,
  SrcInstruction,
} from "./types";

export interface RunOptions {
  readonly yMin?: number;
  readonly yMax?: number;
  readonly bins?: number;
}

const DEFAULT_Y_MIN = -150;
const DEFAULT_Y_MAX = 150;
const DEFAULT_BINS = 161;

/** Everything derived from a Program that both histogram computation and Monte
 * Carlo hit sampling need: the resolved legs, dimensions and the joint state
 * with every measured leg already rotated into its declared theta-basis. */
export interface CompiledProgram {
  readonly program: Program;
  readonly legNames: readonly string[];
  readonly signalIndex: number;
  readonly pathInstr: PathInstruction;
  readonly dims: readonly number[];
  readonly rotated: JointState;
  readonly legWithMeas: ReadonlyMap<number, MeasInstruction>;
  readonly nonSignalLegs: readonly number[];
}

function byKind<K extends Instruction["kind"]>(
  instructions: readonly Instruction[],
  kind: K,
): Extract<Instruction, { kind: K }>[] {
  return instructions.filter(
    (i): i is Extract<Instruction, { kind: K }> => i.kind === kind,
  );
}

export function compileProgram(program: Program): CompiledProgram {
  const srcInstrs = byKind(program.instructions, "src");
  const srcInstr: SrcInstruction | undefined = srcInstrs[0];
  if (!srcInstr) throw new NcieError("program has no SRC instruction");

  const pathInstrs = byKind(program.instructions, "path");
  if (pathInstrs.length === 0) {
    throw new NcieError("program needs a PATH instruction (signal leg)");
  }
  const secondPath = pathInstrs[1];
  if (secondPath) {
    throw new NcieError(
      "only one signal leg (PATH) is supported in this version",
      secondPath.line,
    );
  }
  const pathInstr = pathInstrs[0] as PathInstruction;

  const measInstrs = byKind(program.instructions, "meas");
  const analyzeInstrs = byKind(program.instructions, "analyze");

  const legNames = Array.from({ length: srcInstr.n }, (_, i) => `leg${i + 1}`);
  const legIndexOf = (name: string, line: number): number => {
    const idx = legNames.indexOf(name);
    if (idx === -1) {
      throw new NcieError(
        `unknown leg: "${name}" (SRC declares ${legNames.length} legs)`,
        line,
      );
    }
    return idx;
  };

  const signalIndex = legIndexOf(pathInstr.leg, pathInstr.line);
  const dims = legNames.map((_, idx) =>
    idx === signalIndex ? pathInstr.slits : 2,
  );

  const legWithMeas = new Map<number, MeasInstruction>();
  for (const m of measInstrs) {
    const idx = legIndexOf(m.leg, m.line);
    if (idx === signalIndex) {
      throw new NcieError(
        `MEAS cannot act on the signal leg ("${m.leg}", which already has PATH)`,
        m.line,
      );
    }
    if ((dims[idx] ?? 2) !== 2) {
      throw new NcieError(
        `MEAS is only supported on dimension-2 legs (spin/polarization); ` +
          `${m.leg} has dim=${dims[idx]}`,
        m.line,
      );
    }
    legWithMeas.set(idx, m);
  }

  for (const a of analyzeInstrs) {
    legIndexOf(a.leg, a.line);
    for (const c of a.conditions) {
      const idx = legIndexOf(c.leg, a.line);
      if (!legWithMeas.has(idx)) {
        throw new NcieError(
          `condition uses "${c.leg}" but that leg has no MEAS`,
          a.line,
        );
      }
    }
  }

  const baseState = buildJointState(srcInstr, dims);
  let rotated = baseState;
  for (const [idx, m] of legWithMeas) {
    rotated = rotateLegToMeasBasis(rotated, idx, m.basisTheta);
  }

  const nonSignalLegs = legNames
    .map((_, idx) => idx)
    .filter((idx) => idx !== signalIndex);

  return {
    program,
    legNames,
    signalIndex,
    pathInstr,
    dims,
    rotated,
    legWithMeas,
    nonSignalLegs,
  };
}

/** Amplitude over the signal leg's path index j, given fixed outcomes on a subset
 * of the non-signal legs (`assignment`: legIndex -> 0/1 in that leg's rotated basis). */
export function signalAmplitudes(
  compiled: CompiledProgram,
  assignment: ReadonlyMap<number, number>,
): Complex[] {
  const d = compiled.dims[compiled.signalIndex] ?? 2;
  const n = compiled.legNames.length;
  const out: Complex[] = [];
  for (let j = 0; j < d; j++) {
    const indices = new Array<number>(n).fill(0);
    indices[compiled.signalIndex] = j;
    for (const [legIdx, val] of assignment) indices[legIdx] = val;
    out.push(compiled.rotated.amplitudes.get(keyOf(indices)) ?? Complex.ZERO);
  }
  return out;
}

export interface ComboProfile {
  /** Normalized probability of each slit index, given this combo's amplitude vector. */
  readonly slitProbabilities: readonly number[];
  /** 0 = fully coherent (uniform over slits, wave-like); 1 = which-path fully known
   * (all probability on one slit, particle-like). Derived from the same condAmp
   * vector the histograms use — not a separate/approximate quantity. */
  readonly distinguishability: number;
}

/** Wave-vs-particle profile of the signal leg for a fixed assignment of the other
 * legs. This is the same physics as an ANALYZE HIST conditioned on that assignment,
 * just read off before integrating over y — used to decide how a single round is
 * rendered (as an interfering wave or as a which-path-revealed particle). */
export function comboProfile(
  compiled: CompiledProgram,
  assignment: ReadonlyMap<number, number>,
): ComboProfile {
  const amps = signalAmplitudes(compiled, assignment);
  const raw = amps.map((a) => a.abs2());
  const total = raw.reduce((s, p) => s + p, 0) || 1;
  const slitProbabilities = raw.map((p) => p / total);
  const d = slitProbabilities.length;
  const maxP = Math.max(...slitProbabilities);
  const distinguishability = d > 1 ? (maxP - 1 / d) / (1 - 1 / d) : 1;
  return { slitProbabilities, distinguishability };
}

/** Same as `comboProfile`, but reads the assignment off an already-sampled Hit
 * (as produced by sampleHits) instead of an explicit assignment map. */
export function comboProfileForHit(compiled: CompiledProgram, hit: Hit): ComboProfile {
  const assignment = new Map<number, number>();
  for (const legIdx of compiled.nonSignalLegs) {
    const name = compiled.legNames[legIdx];
    const outcome = name !== undefined ? hit.legOutcomes[name] : undefined;
    if (outcome !== undefined) assignment.set(legIdx, outcome === 1 ? 0 : 1);
  }
  return comboProfile(compiled, assignment);
}

function computeHistogram(
  compiled: CompiledProgram,
  instr: AnalyzeInstruction,
  yGrid: readonly number[],
): HistogramResult {
  const signalName = compiled.legNames[compiled.signalIndex];
  if (instr.leg !== signalName) {
    throw new NcieError(
      `HIST only supports the signal leg ("${signalName}"); received "${instr.leg}"`,
      instr.line,
    );
  }

  const fixed = new Map<number, number>();
  for (const c of instr.conditions) {
    const idx = compiled.legNames.indexOf(c.leg);
    fixed.set(idx, c.outcome === 1 ? 0 : 1);
  }

  const marginalized = compiled.nonSignalLegs.filter((idx) => !fixed.has(idx));
  const combos = cartesianBinary(marginalized.length);

  // Each combo of the marginalized legs carries its own Born-rule probability
  // (Sum_j |condAmp_j|^2, independent of the y-window) and its own diffraction
  // shape. We normalize each combo's shape to integrate to its own probability
  // *before* summing incoherently across combos — this is what makes an
  // unconditioned HIST exactly equal the probability-weighted sum of every
  // conditioned subset (Section 6, first bullet), regardless of grid/window.
  let conditionProbability = 0;
  const raw = new Array<number>(yGrid.length).fill(0);
  for (const combo of combos) {
    const assignment = new Map<number, number>(fixed);
    marginalized.forEach((legIdx, i) => assignment.set(legIdx, combo[i] ?? 0));
    const condAmp = signalAmplitudes(compiled, assignment);
    const comboProbability = condAmp.reduce((s, a) => s + a.abs2(), 0);
    conditionProbability += comboProbability;

    const shape = yGrid.map((y) => screenAmplitude(y, condAmp, compiled.pathInstr).abs2());
    const shapeIntegral = integrate(yGrid, shape);
    if (shapeIntegral < 1e-15) continue;
    const scale = comboProbability / shapeIntegral;
    shape.forEach((v, i) => {
      raw[i] = (raw[i] ?? 0) + v * scale;
    });
  }

  const norm = conditionProbability > 1e-12 ? conditionProbability : 1;
  const bins = yGrid.map((y, i) => ({ y, density: (raw[i] ?? 0) / norm }));

  // Visibility must isolate genuine multi-slit fringe modulation from the
  // single-slit envelope's own rolloff/nulls, which would otherwise swamp the
  // (max-min)/(max+min) metric. The envelope is a common factor of every
  // combo's shape (Section 6: theta controls the fringe/distinguishability
  // trade-off, not the envelope), so dividing it out is exact, not a fudge.
  const deenveloped = yGrid
    .map((y, i) => {
      const envSq = envelope(y, compiled.pathInstr.width) ** 2;
      return envSq > 1e-6 ? (raw[i] ?? 0) / envSq : NaN;
    })
    .filter((v) => Number.isFinite(v));
  const maxD = deenveloped.length ? Math.max(...deenveloped) : 0;
  const minD = deenveloped.length ? Math.min(...deenveloped) : 0;
  const visibility = maxD + minD > 1e-12 ? (maxD - minD) / (maxD + minD) : 0;

  return { instruction: instr, bins, conditionProbability, visibility };
}

export function runProgram(program: Program, options: RunOptions = {}): SimulationResult {
  const compiled = compileProgram(program);
  const yGrid = linspace(
    options.yMin ?? DEFAULT_Y_MIN,
    options.yMax ?? DEFAULT_Y_MAX,
    options.bins ?? DEFAULT_BINS,
  );

  const analyzeInstrs = byKind(program.instructions, "analyze");
  const histograms = analyzeInstrs.map((instr) =>
    computeHistogram(compiled, instr, yGrid),
  );

  const legs: LegInfo[] = compiled.legNames.map((name, idx) => {
    const meas = compiled.legWithMeas.get(idx);
    return {
      name,
      index: idx,
      dim: compiled.dims[idx] ?? 2,
      ...(idx === compiled.signalIndex ? { path: compiled.pathInstr } : {}),
      ...(meas ? { meas } : {}),
      isSignal: idx === compiled.signalIndex,
    };
  });

  const signalLeg = legs[compiled.signalIndex] as LegInfo;

  return { program, legs, signalLeg, histograms };
}
