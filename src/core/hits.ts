import { cartesianBinary, linspace, screenAmplitude } from "./physics";
import { mulberry32 } from "./rng";
import { signalAmplitudes } from "./simulate";
import type { CompiledProgram } from "./simulate";
import type { Hit, Outcome } from "./types";

interface ComboSampler {
  readonly assignment: ReadonlyMap<number, number>;
  readonly probability: number;
  readonly yGrid: readonly number[];
  readonly cdf: readonly number[];
}

function buildComboSamplers(
  compiled: CompiledProgram,
  yGrid: readonly number[],
): ComboSampler[] {
  const combos = cartesianBinary(compiled.nonSignalLegs.length);
  return combos.map((combo) => {
    const assignment = new Map<number, number>();
    compiled.nonSignalLegs.forEach((legIdx, i) => assignment.set(legIdx, combo[i] ?? 0));
    const condAmp = signalAmplitudes(compiled, assignment);
    const densities = yGrid.map((y) => screenAmplitude(y, condAmp, compiled.pathInstr).abs2());
    // Born-rule probability of this combo comes from the state amplitudes, not
    // from integrating the diffraction shape (see simulate.ts computeHistogram).
    const probability = condAmp.reduce((s, a) => s + a.abs2(), 0);

    const cdf: number[] = [0];
    for (let i = 1; i < yGrid.length; i++) {
      const y0 = yGrid[i - 1] ?? 0;
      const y1 = yGrid[i] ?? 0;
      const d0 = densities[i - 1] ?? 0;
      const d1 = densities[i] ?? 0;
      const prev = cdf[i - 1] ?? 0;
      cdf.push(prev + ((d0 + d1) / 2) * (y1 - y0));
    }
    const total = cdf[cdf.length - 1] ?? 1;
    const normalizedCdf = cdf.map((v) => (total > 1e-15 ? v / total : v));

    return { assignment, probability, yGrid, cdf: normalizedCdf };
  });
}

function sampleFromCdf(rng: () => number, yGrid: readonly number[], cdf: readonly number[]): number {
  const u = rng();
  let i = 1;
  while (i < cdf.length && (cdf[i] ?? 1) < u) i++;
  const y0 = yGrid[i - 1] ?? 0;
  const y1 = yGrid[i] ?? y0;
  const c0 = cdf[i - 1] ?? 0;
  const c1 = cdf[i] ?? 1;
  const t = c1 - c0 > 1e-15 ? (u - c0) / (c1 - c0) : 0;
  return y0 + t * (y1 - y0);
}

/** Draws `count` independent "rounds": samples an outcome for every non-signal leg
 * from the Born rule, then a screen position from the resulting conditional
 * interference pattern. Used only for the animated buildup visual; ANALYZE
 * histograms use the exact analytic density instead. */
export function sampleHits(
  compiled: CompiledProgram,
  count: number,
  seed: number,
  yRange: { min: number; max: number; resolution?: number } = { min: -150, max: 150 },
): Hit[] {
  const yGrid = linspace(yRange.min, yRange.max, yRange.resolution ?? 241);
  const samplers = buildComboSamplers(compiled, yGrid);
  const totalProb = samplers.reduce((s, c) => s + c.probability, 0) || 1;

  const rng = mulberry32(seed);
  const hits: Hit[] = [];
  for (let r = 0; r < count; r++) {
    let u = rng() * totalProb;
    let chosen = samplers[0];
    for (const sampler of samplers) {
      if (u <= sampler.probability) {
        chosen = sampler;
        break;
      }
      u -= sampler.probability;
    }
    if (!chosen) continue;

    const screenY = sampleFromCdf(rng, chosen.yGrid, chosen.cdf);
    const legOutcomes: Record<string, Outcome> = {};
    for (const [legIdx, val] of chosen.assignment) {
      const name = compiled.legNames[legIdx];
      if (name !== undefined) legOutcomes[name] = val === 0 ? 1 : -1;
    }
    hits.push({ legOutcomes, screenY });
  }
  return hits;
}
