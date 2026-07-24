import { Complex } from "./complex";
import { NcieError } from "./types";
import type { SrcInstruction } from "./types";

/** Amplitude tensor over N legs, indexed by a comma-joined tuple key "j1,j2,...,jN". */
export interface JointState {
  readonly dims: readonly number[];
  readonly amplitudes: ReadonlyMap<string, Complex>;
}

export function keyOf(indices: readonly number[]): string {
  return indices.join(",");
}

function assertAllDim2(dims: readonly number[], line: number): void {
  if (dims.some((d) => d !== 2)) {
    throw new NcieError(
      "named states (Bell/GHZ/W) are defined over dimension-2 legs " +
        `(qubit); dims=[${dims.join(", ")}]. Adjust PATH(slits=2) on the signal leg.`,
      line,
    );
  }
}

export function buildJointState(
  src: SrcInstruction,
  dims: readonly number[],
): JointState {
  if (dims.length !== src.n) {
    throw new NcieError(
      `SRC(${src.id}) declares ${src.n} legs but ${dims.length} were resolved`,
      src.line,
    );
  }

  const amplitudes = new Map<string, Complex>();
  const n = src.n;
  const inv_sqrt2 = 1 / Math.sqrt(2);

  switch (src.state.kind) {
    case "bell": {
      assertAllDim2(dims, src.line);
      const sign = src.state.variant.endsWith("-") ? -1 : 1;
      if (src.state.variant.startsWith("Phi")) {
        amplitudes.set(keyOf([0, 0]), new Complex(inv_sqrt2));
        amplitudes.set(keyOf([1, 1]), new Complex(sign * inv_sqrt2));
      } else {
        amplitudes.set(keyOf([0, 1]), new Complex(inv_sqrt2));
        amplitudes.set(keyOf([1, 0]), new Complex(sign * inv_sqrt2));
      }
      break;
    }
    case "ghz": {
      assertAllDim2(dims, src.line);
      const amp = 1 / Math.sqrt(2);
      amplitudes.set(keyOf(new Array(n).fill(0)), new Complex(amp));
      amplitudes.set(keyOf(new Array(n).fill(1)), new Complex(amp));
      break;
    }
    case "w": {
      assertAllDim2(dims, src.line);
      const amp = 1 / Math.sqrt(n);
      for (let k = 0; k < n; k++) {
        const idx = new Array(n).fill(0);
        idx[k] = 1;
        amplitudes.set(keyOf(idx), new Complex(amp));
      }
      break;
    }
    case "coherent": {
      if (n !== 1) {
        throw new NcieError("coherent state requires type=... x1", src.line);
      }
      const d = dims[0] ?? 2;
      const amp = 1 / Math.sqrt(d);
      for (let j = 0; j < d; j++) {
        amplitudes.set(keyOf([j]), new Complex(amp));
      }
      break;
    }
    case "explicit": {
      let normSq = 0;
      for (const term of src.state.terms) {
        term.indices.forEach((idx, leg) => {
          const dim = dims[leg] ?? 2;
          if (idx < 0 || idx >= dim) {
            throw new NcieError(
              `index ${idx} out of range for leg${leg + 1} (dim=${dim})`,
              src.line,
            );
          }
        });
        normSq += term.amplitude.abs2();
      }
      if (normSq < 1e-15) {
        throw new NcieError("explicit state has zero norm", src.line);
      }
      const scale = 1 / Math.sqrt(normSq);
      for (const term of src.state.terms) {
        const key = keyOf(term.indices);
        const existing = amplitudes.get(key) ?? Complex.ZERO;
        amplitudes.set(key, existing.add(term.amplitude.scale(scale)));
      }
      break;
    }
  }

  return { dims, amplitudes };
}

/** Rotates leg `legIndex` (must be dim 2) into the theta-basis: |+> = cos(t/2)|0>+sin(t/2)|1>,
 * |-> = -sin(t/2)|0>+cos(t/2)|1>. theta=0 reproduces the computational (which-path) basis;
 * theta=pi/2 gives the conjugate (erasing) basis. Output index 0 <-> outcome +1, index 1 <-> -1. */
export function rotateLegToMeasBasis(
  state: JointState,
  legIndex: number,
  theta: number,
): JointState {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  const coeff = (r: 0 | 1, orig: 0 | 1): number => {
    if (r === 0) return orig === 0 ? c : s;
    return orig === 0 ? -s : c;
  };

  const next = new Map<string, Complex>();
  for (const [key, amp] of state.amplitudes) {
    const indices = key.split(",").map(Number);
    const orig = indices[legIndex] as 0 | 1;
    for (const r of [0, 1] as const) {
      const newIndices = indices.slice();
      newIndices[legIndex] = r;
      const newKey = keyOf(newIndices);
      const contribution = amp.scale(coeff(r, orig));
      next.set(newKey, (next.get(newKey) ?? Complex.ZERO).add(contribution));
    }
  }
  return { dims: state.dims, amplitudes: next };
}
