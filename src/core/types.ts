import type { Complex } from "./complex";

/** Section 4 — particle types and how their which-path partner is realized. */
export type ParticleType = "photon" | "electron" | "neutron" | "atom";

export type BellVariant = "Phi+" | "Phi-" | "Psi+" | "Psi-";

/** SRC "state=" payload (Section 2 / 4). Every named state is over qubit legs
 * (dim 2), matching Section 4's table where every particle type's theta=0/theta=pi/2
 * bases are two-outcome. "explicit" lets the author give arbitrary-dimension amplitudes. */
export type StateSpec =
  | { readonly kind: "bell"; readonly variant: BellVariant }
  | { readonly kind: "ghz" }
  | { readonly kind: "w" }
  | { readonly kind: "coherent" }
  | { readonly kind: "explicit"; readonly terms: readonly ExplicitTerm[] };

export interface ExplicitTerm {
  readonly indices: readonly number[];
  readonly amplitude: Complex;
}

export interface SrcInstruction {
  readonly kind: "src";
  readonly line: number;
  readonly id: string;
  readonly particleType: ParticleType;
  readonly n: number;
  readonly state: StateSpec;
}

export interface PathInstruction {
  readonly kind: "path";
  readonly line: number;
  readonly leg: string;
  readonly slits: number;
  readonly spacing: number;
  readonly width: number;
}

export type Timing = "before" | "after";

export interface MeasInstruction {
  readonly kind: "meas";
  readonly line: number;
  readonly leg: string;
  readonly basisTheta: number;
  readonly timing?: Timing;
}

export type Outcome = 1 | -1;

export interface Condition {
  readonly leg: string;
  readonly outcome: Outcome;
}

export interface AnalyzeInstruction {
  readonly kind: "analyze";
  readonly line: number;
  readonly leg: string;
  readonly conditions: readonly Condition[];
  readonly comment?: string;
}

export type Instruction =
  | SrcInstruction
  | PathInstruction
  | MeasInstruction
  | AnalyzeInstruction;

export interface Program {
  readonly source: string;
  readonly instructions: readonly Instruction[];
}

/** Resolved per-leg bookkeeping computed while building the joint state. */
export interface LegInfo {
  readonly name: string;
  readonly index: number;
  readonly dim: number;
  readonly path?: PathInstruction;
  readonly meas?: MeasInstruction;
  readonly isSignal: boolean;
}

export interface HistogramBin {
  readonly y: number;
  readonly density: number;
}

export interface HistogramResult {
  readonly instruction: AnalyzeInstruction;
  readonly bins: readonly HistogramBin[];
  /** P(conditions) under the joint state — 1 when there are no conditions. */
  readonly conditionProbability: number;
  /** Fringe visibility V = (Imax - Imin) / (Imax + Imin) over the bins. */
  readonly visibility: number;
}

export interface Hit {
  readonly legOutcomes: Readonly<Record<string, Outcome>>;
  readonly screenY: number;
}

export interface SimulationResult {
  readonly program: Program;
  readonly legs: readonly LegInfo[];
  readonly signalLeg: LegInfo;
  readonly histograms: readonly HistogramResult[];
}

export class NcieError extends Error {
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(message);
    this.name = "NcieError";
    this.line = line;
  }
}
