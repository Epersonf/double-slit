export interface Example {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: "5.1",
    title: "5.1 — base case (N=1)",
    description: "Ordinary double slit, no entanglement. Simple interference fringe.",
    source: `SRC(s1): type=photon x1, state=coherent
leg1: PATH(slits=2, spacing=40, width=10)
ANALYZE: HIST(leg1) // ordinary interference fringe`,
  },
  {
    id: "5.2",
    title: "5.2 — quantum eraser (N=2)",
    description:
      "Bell pair; leg2 measured at basis=pi/2 erases the which-path information.",
    source: `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/2)
ANALYZE: HIST(leg1) // raw -> no fringe
ANALYZE: HIST(leg1 | leg2=+1) // subset -> fringe
ANALYZE: HIST(leg1 | leg2=-1) // subset -> complementary fringe`,
  },
  {
    id: "5.2-reveal",
    title: "5.2b — same leg, basis=0 (reveals path)",
    description: "Same circuit, but basis=0: each subset shows a no-fringe pattern.",
    source: `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=0)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1)
ANALYZE: HIST(leg1 | leg2=-1)`,
  },
  {
    id: "5.3",
    title: "5.3 — GHZ generalization (N=3)",
    description:
      "GHZ(3) source: one signal leg, two measurement legs. Fringe depends on the parity of the outcomes.",
    source: `SRC(s1): type=photon x3, state=GHZ(3)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/2)
leg3: MEAS(basis=pi/2)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=+1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=-1)
ANALYZE: HIST(leg1 | leg2=-1, leg3=+1)
ANALYZE: HIST(leg1 | leg2=-1, leg3=-1)`,
  },
  {
    id: "w-state",
    title: "extra — W state (N=3)",
    description: "W(3) entanglement instead of GHZ: weaker correlations between the legs.",
    source: `SRC(s1): type=photon x3, state=W(3)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/2)
leg3: MEAS(basis=pi/2)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=+1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=-1)`,
  },
  {
    id: "partial",
    title: "extra — partial erasure (intermediate basis)",
    description: "theta between 0 and pi/2: partial which-path information, low-visibility fringe.",
    source: `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/4)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1)
ANALYZE: HIST(leg1 | leg2=-1)`,
  },
  {
    id: "all-particle",
    title: "extra — every round is a particle (basis=0)",
    description:
      "Full which-path information: every single round in the apparatus renders as a particle through one slit, never a wave.",
    source: `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=0)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1)
ANALYZE: HIST(leg1 | leg2=-1)`,
  },
  {
    id: "delayed-choice-before",
    title: "extra — measure before it arrives (time=before)",
    description:
      "The partner is measured (and which-path revealed) before the signal even reaches the screen — still no fringe, even conditioned. Watch the analyzer flash near the source instead of near the screen.",
    source: `SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=0, time=before)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1)
ANALYZE: HIST(leg1 | leg2=-1)`,
  },
];
