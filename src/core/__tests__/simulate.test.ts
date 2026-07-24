import { describe, expect, it } from "vitest";
import { parseProgram } from "../parser";
import { compileProgram, comboProfile, runProgram } from "../simulate";
import { EXAMPLES } from "../examples";
import { NcieError } from "../types";
import type { HistogramResult } from "../types";

function findHist(histograms: readonly HistogramResult[], expr: string): HistogramResult {
  const found = histograms.find((h) => describeCondition(h) === expr);
  if (!found) {
    throw new Error(
      `histogram "${expr}" not found; available: ${histograms.map(describeCondition).join(", ")}`,
    );
  }
  return found;
}

function describeCondition(h: HistogramResult): string {
  const cond = h.instruction.conditions.map((c) => `${c.leg}=${c.outcome > 0 ? "+1" : "-1"}`).join(",");
  return cond.length === 0 ? h.instruction.leg : `${h.instruction.leg}|${cond}`;
}

describe("every example in the draft compiles and runs", () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: "${ex.title}"`, () => {
      const program = parseProgram(ex.source);
      const result = runProgram(program);
      expect(result.histograms.length).toBeGreaterThan(0);
      for (const h of result.histograms) {
        expect(h.bins.length).toBeGreaterThan(0);
        for (const b of h.bins) expect(Number.isFinite(b.density)).toBe(true);
      }
    });
  }
});

describe("5.1 — base case N=1", () => {
  it("shows an ordinary interference fringe", () => {
    const result = runProgram(parseProgram(EXAMPLES[0]!.source));
    const h = findHist(result.histograms, "leg1");
    expect(h.visibility).toBeGreaterThan(0.8);
  });
});

describe("5.2 — quantum eraser (Section 6, bullet 1)", () => {
  const program = parseProgram(EXAMPLES[1]!.source); // basis=pi/2 (erasing)
  const result = runProgram(program);

  it("unconditioned HIST never shows a fringe", () => {
    const marginal = findHist(result.histograms, "leg1");
    expect(marginal.visibility).toBeLessThan(0.05);
  });

  it("each conditioned subset shows a fringe", () => {
    const plus = findHist(result.histograms, "leg1|leg2=+1");
    const minus = findHist(result.histograms, "leg1|leg2=-1");
    expect(plus.visibility).toBeGreaterThan(0.8);
    expect(minus.visibility).toBeGreaterThan(0.8);
  });

  it("the marginal is exactly the (weighted) sum of the conditioned subsets", () => {
    const marginal = findHist(result.histograms, "leg1");
    const plus = findHist(result.histograms, "leg1|leg2=+1");
    const minus = findHist(result.histograms, "leg1|leg2=-1");
    for (let i = 0; i < marginal.bins.length; i++) {
      const marginalRaw = (marginal.bins[i]?.density ?? 0) * marginal.conditionProbability;
      const plusRaw = (plus.bins[i]?.density ?? 0) * plus.conditionProbability;
      const minusRaw = (minus.bins[i]?.density ?? 0) * minus.conditionProbability;
      expect(marginalRaw).toBeCloseTo(plusRaw + minusRaw, 6);
    }
  });

  it("P(leg2=+1) + P(leg2=-1) = 1", () => {
    const plus = findHist(result.histograms, "leg1|leg2=+1");
    const minus = findHist(result.histograms, "leg1|leg2=-1");
    expect(plus.conditionProbability + minus.conditionProbability).toBeCloseTo(1, 6);
  });

  it("the subsets are complementary (fringes shifted by half a period)", () => {
    const plus = findHist(result.histograms, "leg1|leg2=+1");
    const minus = findHist(result.histograms, "leg1|leg2=-1");
    const center = Math.floor(plus.bins.length / 2);
    // near y=0 the single-slit envelope is nearly constant, so the sign of the
    // local max/min directly reflects the fringe's phase.
    expect(plus.bins[center]!.density).toBeGreaterThan(plus.bins[center - 3]!.density);
    expect(minus.bins[center]!.density).toBeLessThan(minus.bins[center - 3]!.density);
  });
});

describe("5.2b — basis=0 reveals which-path", () => {
  it("each subset shows NO fringe when basis=0", () => {
    const result = runProgram(parseProgram(EXAMPLES[2]!.source));
    const plus = findHist(result.histograms, "leg1|leg2=+1");
    const minus = findHist(result.histograms, "leg1|leg2=-1");
    expect(plus.visibility).toBeLessThan(0.05);
    expect(minus.visibility).toBeLessThan(0.05);
  });
});

describe("EGY duality: visibility grows with theta (0 -> pi/2)", () => {
  it("V(theta=0) < V(theta=pi/4) < V(theta=pi/2)", () => {
    const make = (basis: string) =>
      runProgram(
        parseProgram(`SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=${basis})
ANALYZE: HIST(leg1 | leg2=+1)`),
      );

    const v0 = findHist(make("0").histograms, "leg1|leg2=+1").visibility;
    const v4 = findHist(make("pi/4").histograms, "leg1|leg2=+1").visibility;
    const v2 = findHist(make("pi/2").histograms, "leg1|leg2=+1").visibility;

    expect(v0).toBeLessThan(v4);
    expect(v4).toBeLessThan(v2);
    expect(v2).toBeGreaterThan(0.8);
    expect(v0).toBeLessThan(0.05);
  });
});

describe("comboProfile: wave/particle distinguishability drives the stage animation", () => {
  it("is fully particle-like (distinguishability=1) when basis=0 reveals the path", () => {
    const compiled = compileProgram(parseProgram(EXAMPLES[2]!.source)); // basis=0
    const profile = comboProfile(compiled, new Map([[1, 0]])); // leg2 -> outcome +1
    expect(profile.distinguishability).toBeCloseTo(1, 6);
    expect(Math.max(...profile.slitProbabilities)).toBeCloseTo(1, 6);
  });

  it("is fully wave-like (distinguishability=0) when basis=pi/2 erases the path", () => {
    const compiled = compileProgram(parseProgram(EXAMPLES[1]!.source)); // basis=pi/2
    const profile = comboProfile(compiled, new Map([[1, 0]]));
    expect(profile.distinguishability).toBeCloseTo(0, 6);
    expect(profile.slitProbabilities[0]).toBeCloseTo(0.5, 6);
    expect(profile.slitProbabilities[1]).toBeCloseTo(0.5, 6);
  });

  it("is fully wave-like for the N=1 coherent case (nothing to distinguish with)", () => {
    const compiled = compileProgram(parseProgram(EXAMPLES[0]!.source));
    const profile = comboProfile(compiled, new Map());
    expect(profile.distinguishability).toBeCloseTo(0, 6);
  });
});

describe("5.3 — GHZ(3): fringe depends on the parity of the outcomes", () => {
  const result = runProgram(parseProgram(EXAMPLES[3]!.source));

  it("unconditioned HIST never shows a fringe (generalizes N=2)", () => {
    const marginal = findHist(result.histograms, "leg1");
    expect(marginal.visibility).toBeLessThan(0.05);
  });

  it("same-parity combinations produce the same fringe", () => {
    const pp = findHist(result.histograms, "leg1|leg2=+1,leg3=+1");
    const mm = findHist(result.histograms, "leg1|leg2=-1,leg3=-1");
    for (let i = 0; i < pp.bins.length; i++) {
      expect(pp.bins[i]!.density).toBeCloseTo(mm.bins[i]!.density, 6);
    }
  });

  it("opposite-parity combinations produce the same fringe as each other", () => {
    const pm = findHist(result.histograms, "leg1|leg2=+1,leg3=-1");
    const mp = findHist(result.histograms, "leg1|leg2=-1,leg3=+1");
    for (let i = 0; i < pm.bins.length; i++) {
      expect(pm.bins[i]!.density).toBeCloseTo(mp.bins[i]!.density, 6);
    }
  });

  it("opposite parity is shifted half a period relative to same parity", () => {
    const pp = findHist(result.histograms, "leg1|leg2=+1,leg3=+1");
    const pm = findHist(result.histograms, "leg1|leg2=+1,leg3=-1");
    const center = Math.floor(pp.bins.length / 2);
    // at screen center (y=0) the two slits are in phase for "same parity"
    // and out of phase for "opposite parity" (derived in states.ts/rotateLegToMeasBasis).
    expect(pp.bins[center]!.density).toBeGreaterThan(pm.bins[center]!.density);
  });
});

describe("parser: errors carry the line number", () => {
  it("rejects an unrecognized instruction", () => {
    expect(() => parseProgram("BOGUS(x)")).toThrow(NcieError);
  });

  it("rejects a Bell state with N != 2", () => {
    expect(() =>
      parseProgram("SRC(s1): type=photon x3, state=Bell(Phi+)"),
    ).toThrow(/Bell/);
  });

  it("rejects a condition on a leg without MEAS", () => {
    const src = `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
ANALYZE: HIST(leg1 | leg2=+1)`;
    expect(() => runProgram(parseProgram(src))).toThrow(/MEAS/);
  });
});
