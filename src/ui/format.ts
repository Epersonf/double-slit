import type { AnalyzeInstruction } from "../core/types";

export function conditionLabel(instr: AnalyzeInstruction): string {
  if (instr.conditions.length === 0) return `HIST(${instr.leg})`;
  const conds = instr.conditions
    .map((c) => `${c.leg}=${c.outcome > 0 ? "+1" : "-1"}`)
    .join(", ");
  return `HIST(${instr.leg} | ${conds})`;
}

export function formatTheta(theta: number): string {
  const overPi = theta / Math.PI;
  if (Math.abs(theta) < 1e-9) return "0";
  if (Math.abs(overPi - 1) < 1e-9) return "pi";
  if (Math.abs(overPi + 1) < 1e-9) return "-pi";
  for (const d of [2, 3, 4, 6, 8]) {
    const k = overPi * d;
    if (Math.abs(k - Math.round(k)) < 1e-6) {
      const kr = Math.round(k);
      if (kr === 1) return `pi/${d}`;
      if (kr === -1) return `-pi/${d}`;
      return `${kr}pi/${d}`;
    }
  }
  return theta.toFixed(3);
}
