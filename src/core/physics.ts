import { Complex } from "./complex";
import type { PathInstruction } from "./types";

/** Arbitrary but fixed optical constants (same units as spacing/width) that
 * give a handful of visible fringes across the default screen window. */
export const WAVELENGTH = 0.5;
export const SCREEN_DISTANCE = 1000;

export function slitPositions(slits: number, spacing: number): number[] {
  return Array.from({ length: slits }, (_, j) => (j - (slits - 1) / 2) * spacing);
}

/** Single-slit (Fraunhofer) diffraction envelope, sinc(pi * width * y / (lambda L)). */
export function envelope(y: number, width: number): number {
  const arg = (Math.PI * width * y) / (WAVELENGTH * SCREEN_DISTANCE);
  if (Math.abs(arg) < 1e-9) return 1;
  return Math.sin(arg) / arg;
}

/** Coherent superposition amplitude reaching the screen at position y, given the
 * (possibly conditioned/entangled) per-slit amplitude vector condAmp[j]. */
export function screenAmplitude(
  y: number,
  condAmp: readonly Complex[],
  path: PathInstruction,
): Complex {
  const positions = slitPositions(path.slits, path.spacing);
  let sum = Complex.ZERO;
  for (let j = 0; j < condAmp.length; j++) {
    const x = positions[j] ?? 0;
    const phase = (2 * Math.PI * x * y) / (WAVELENGTH * SCREEN_DISTANCE);
    sum = sum.add((condAmp[j] ?? Complex.ZERO).mul(Complex.fromPolar(1, phase)));
  }
  return sum.scale(envelope(y, path.width));
}

export function linspace(min: number, max: number, count: number): number[] {
  if (count === 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

/** Trapezoidal integration of ys over the (possibly unevenly spaced) grid xs. */
export function integrate(xs: readonly number[], ys: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1] ?? 0;
    const x1 = xs[i] ?? 0;
    const y0 = ys[i - 1] ?? 0;
    const y1 = ys[i] ?? 0;
    total += ((y0 + y1) / 2) * (x1 - x0);
  }
  return total;
}

export function cartesianBinary(k: number): number[][] {
  if (k === 0) return [[]];
  const total = 2 ** k;
  const out: number[][] = [];
  for (let i = 0; i < total; i++) {
    const combo: number[] = [];
    for (let b = k - 1; b >= 0; b--) {
      combo.push((i >> b) & 1);
    }
    out.push(combo);
  }
  return out;
}
