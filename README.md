# Double-Slit Visualizer

**Live demo:** https://epersonf.github.io/double-slit/

An interactive simulator and visual "player" for double-slit interference
experiments — including entangled variants (quantum eraser, GHZ, W states,
delayed choice). You don't configure the experiment through a form; you write
it in a small textual language, **NCIE** (*Notation for Interference and
Entanglement Circuits*), and the app parses it, computes the exact quantum
mechanical prediction, and animates individual "rounds" landing on a screen
in real time.

## Motivation

The double-slit experiment is usually taught as a single fixed picture:
particles through two slits, an interference pattern builds up, and "if you
measure which slit, the pattern disappears." That story is correct but
hides most of what's interesting: *partial* which-path information,
*correlated* measurement of an entangled partner particle (the quantum
eraser), multi-particle generalizations (GHZ/W states), and the fact that
the choice of what to measure can be made *after* the signal particle has
already hit the screen (delayed choice) without changing any statistics.

This project is an attempt to make those variants **executable** instead of
just described. Every claim ("erasing which-path info at basis=π/2 restores
the fringe," "the raw/unconditioned histogram has no fringe even though its
sub-histograms do," "measurement order doesn't matter") is something you can
write as a program, run, and watch — both as an exact analytic histogram and
as a Monte Carlo animation converging to it. It's built around a specific,
if informal, textual notation (NCIE) for describing these "interference and
entanglement circuits" concisely, rather than wiring up a bespoke UI control
for every experiment variant.

## What it does

- **Parses** an NCIE program into an AST (`src/core/parser.ts`).
- **Compiles** it into a joint quantum state over all declared particles
  (legs), rotating every measured leg into its declared basis
  (`src/core/states.ts`, `src/core/simulate.ts`).
- **Computes** exact interference histograms for every `ANALYZE` instruction,
  including conditional ones (e.g. "signal leg, given the partner was
  measured `+1`"), via Fraunhofer diffraction physics
  (`src/core/physics.ts`).
- **Samples** individual "rounds" via Monte Carlo (Born rule + inverse-CDF
  sampling) and animates them flying from source → slits → screen, rendered
  as a particle or a wave depending on how much which-path information is
  available for that round (`src/core/hits.ts`, `src/ui/ExperimentStage.tsx`).
- **Reports** fringe visibility and conditional probability per histogram,
  and lets you click a histogram to filter the live animation down to just
  that subset of rounds.

## Quickstart

```bash
npm install
npm run dev       # start the Vite dev server
npm run build      # type-check + production build to dist/
npm run test       # run the Vitest suite (src/core/__tests__)
npm run lint       # ESLint
```

## The NCIE language

An NCIE program is plain text, parsed line by line. Each non-empty,
non-comment line is exactly one instruction. `//` starts a trailing comment
(stripped before parsing, but kept for `ANALYZE` labels).

A minimal program needs exactly one `SRC`, at least one `PATH` (the *signal
leg* — the one that actually reaches a screen), and at least one `ANALYZE`.

```ncie
SRC(s1): type=photon x1, state=coherent
leg1: PATH(slits=2, spacing=40, width=10)
ANALYZE: HIST(leg1) // ordinary interference fringe
```

### `SRC` — declare the source and its quantum state

```
SRC(<id>): type=<particleType> x<N>, state=<StateSpec>
```

- `<id>` — an identifier for the source (currently cosmetic).
- `type` — one of `photon`, `electron`, `neutron`, `atom`.
- `x<N>` — number of particles/legs in the joint system (e.g. `x1`, `x2`,
  `x3`). This declares `leg1 .. legN`.
- `state` — see **State specs** below.

### Legs — `PATH` and `MEAS`

Every leg declared by `SRC` (`leg1`, `leg2`, ...) can get **one** of:

```
leg<k>: PATH(slits=<int>, spacing=<num>, width=<num>)
leg<k>: MEAS(basis=<angle>[, time=before|after])
```

- **`PATH`** marks the *signal leg* — the one particle that travels through
  a multi-slit barrier to a screen. Exactly one `PATH` is supported per
  program.
  - `slits` — integer ≥ 2, number of slits.
  - `spacing` — center-to-center distance between adjacent slits.
  - `width` — slit width (controls the single-slit diffraction envelope).
- **`MEAS`** measures a non-signal leg (the entangled partner) in a
  rotated basis before combining it into the joint state.
  - `basis` — an angle θ (see **Angle syntax**). `θ=0` is the computational
    (which-path-revealing) basis; `θ=π/2` is the conjugate
    (which-path-erasing) basis; anything in between gives partial
    information / partial visibility.
  - `time` — optional, `before` or `after`. Purely cosmetic/pedagogical: it
    only changes *when* the animated "analyzer flash" fires relative to the
    signal particle's flight (near the source vs. near the screen), to
    illustrate that the order doesn't affect any statistics. It has no
    effect on the computed histograms.
  - `MEAS` only works on dimension-2 legs (spin/polarization qubits) and
    cannot be applied to the signal leg.

A leg with neither `PATH` nor `MEAS` is simply traced out (unmeasured).

### `ANALYZE` — request a histogram

```
ANALYZE: HIST(<signalLeg> [| <leg>=<outcome>[, <leg>=<outcome> ...]])
```

- Always targets the signal leg (the one with `PATH`).
- With no conditions, it's the marginal (unconditioned) histogram.
- After `|`, a comma-separated list of `leg=outcome` conditions restricts
  the histogram to rounds where those partner legs collapsed to that
  outcome. `outcome` is `+1` or `-1`.
- A trailing `//` comment becomes the panel's label in the UI.

You can have as many `ANALYZE` lines as you want — e.g. the raw histogram
plus every conditional sub-histogram, to see how they recombine into the
marginal.

### Angle syntax

Used by `MEAS(basis=...)`. Accepts:

- A plain number (radians): `0`, `1.5708`
- `pi`, `-pi`, `pi/2`, `-pi/2`, `pi/4`, `3*pi/4`, etc. — an optional sign,
  optional numeric coefficient, `pi`, and an optional `/denominator`.

### State specs (`state=...` in `SRC`)

| Spec | Legs (`x<N>`) | Meaning |
|---|---|---|
| `coherent` | `x1` | Equal-amplitude superposition over all `slits` positions of the signal leg — the ordinary single-particle double-slit state. |
| `Bell(Phi+)` / `Bell(Phi-)` / `Bell(Psi+)` / `Bell(Psi-)` | `x2` | The four two-qubit Bell states, used for the quantum-eraser setup (signal leg entangled with one partner leg). |
| `GHZ` or `GHZ(N)` | `x2`+ | Greenberger–Horne–Zeilinger state `(|00...0> + |11...1>)/√2` over N legs. |
| `W` or `W(N)` | `x2`+ | W state: equal superposition of all single-excitation basis states. |
| `explicit(<bits>=<amp>[, <bits>=<amp> ...])` | any | Arbitrary amplitudes you specify by hand. `<bits>` is an `N`-digit string (one digit per leg, digit = basis index for that leg); `<amp>` is a real coefficient. Terms are automatically renormalized. Example for 2 legs: `explicit(00=1, 11=1)` is the same (up to global phase) as `Bell(Phi+)`. |

Named entangled states (`Bell`, `GHZ`, `W`) require every leg to be
dimension 2 — i.e. the signal leg's `PATH` must use `slits=2` if you want
one of these states.

### Full worked examples

The app ships these as built-in, selectable examples
(`src/core/examples.ts`):

**Ordinary double slit (no entanglement):**

```ncie
SRC(s1): type=photon x1, state=coherent
leg1: PATH(slits=2, spacing=40, width=10)
ANALYZE: HIST(leg1) // ordinary interference fringe
```

**Quantum eraser:** the partner is measured in the erasing basis
(`π/2`); the raw pattern shows no fringe, but each conditioned subset does
(as complementary fringes that cancel each other out in the sum):

```ncie
SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/2)
ANALYZE: HIST(leg1) // raw -> no fringe
ANALYZE: HIST(leg1 | leg2=+1) // subset -> fringe
ANALYZE: HIST(leg1 | leg2=-1) // subset -> complementary fringe
```

**GHZ generalization (3 particles):** the signal leg's fringe depends on
the joint parity of the two partner outcomes:

```ncie
SRC(s1): type=photon x3, state=GHZ(3)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=pi/2)
leg3: MEAS(basis=pi/2)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=+1)
ANALYZE: HIST(leg1 | leg2=+1, leg3=-1)
ANALYZE: HIST(leg1 | leg2=-1, leg3=+1)
ANALYZE: HIST(leg1 | leg2=-1, leg3=-1)
```

**Delayed choice:** the partner is measured *before* the signal particle
even reaches the screen (`time=before`) — the statistics are identical to
measuring it after, demonstrating that the temporal order of measurement
doesn't matter:

```ncie
SRC(s1): type=photon x2, state=Bell(Phi+)
leg1: PATH(slits=2, spacing=40, width=10)
leg2: MEAS(basis=0, time=before)
ANALYZE: HIST(leg1)
ANALYZE: HIST(leg1 | leg2=+1)
ANALYZE: HIST(leg1 | leg2=-1)
```

More variants (partial erasure at intermediate angles, W states, "every
round renders as a particle") are available from the example picker in the
app.

## The physics, briefly

- The signal leg's amplitude at screen position `y` is the coherent sum,
  over each slit, of a plane-wave phase term times a single-slit
  (Fraunhofer/sinc) diffraction envelope (`src/core/physics.ts`).
- Every non-signal leg with a `MEAS` is rotated into its declared basis
  (`cos(θ/2)`/`sin(θ/2)` qubit rotation) *before* the joint state is used, so
  conditioning on an outcome (`leg2=+1`) is just picking out the amplitude
  slice where that leg's rotated index is 0.
- An `ANALYZE` histogram sums, incoherently, over every combination of the
  *unconditioned* partner legs, each weighted by its own Born-rule
  probability — so the marginal histogram is always exactly the
  probability-weighted sum of every conditional sub-histogram, regardless
  of the screen grid.
- **Fringe visibility** `V = (Imax − Imin)/(Imax + Imin)` is computed after
  dividing out the single-slit envelope, so it isolates genuine multi-slit
  interference from the envelope's own rolloff.
- **Distinguishability** (0 = fully wave-like, 1 = which-path fully known)
  drives how a single animated round is rendered: as a particle through one
  slit, as a wave through all slits, or a blend of both.
- The live animation uses Monte Carlo sampling (inverse-CDF over the exact
  density) purely for the visual buildup; the histograms and visibility
  themselves are computed analytically, not estimated from the samples.

## Project structure

```
src/
  core/            # the NCIE engine — no React, unit-testable in isolation
    complex.ts      # minimal complex number type
    parser.ts       # NCIE text -> AST (Program/Instruction)
    types.ts        # AST + domain types, NcieError
    states.ts       # AST -> joint quantum state (Bell/GHZ/W/explicit), basis rotation
    physics.ts       # diffraction physics (slit positions, envelope, amplitude, integration)
    simulate.ts      # compiles a Program, computes exact ANALYZE histograms
    hits.ts          # Monte Carlo sampling of individual rounds for the animation
    rng.ts           # seeded PRNG (mulberry32) for reproducible runs
    examples.ts       # built-in example programs shown in the UI
    __tests__/       # Vitest suite
  ui/
    CodeEditor.tsx        # NCIE source editor (with error-line highlighting)
    ExamplePicker.tsx     # built-in example selector
    CircuitDiagram.tsx    # textual circuit summary (SRC/PATH/MEAS per leg)
    ExperimentStage.tsx   # canvas animation: rounds flying from source to screen
    AnalyzePanel.tsx      # per-ANALYZE histogram chart + visibility/probability readout
    useExperimentPlayer.ts # play/pause/step/speed state machine driving the shared round clock
    format.ts             # display formatting (angles, condition labels)
  App.tsx            # wires parser -> simulator -> UI panels together
```

## Tech stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/) for dev/build
- [Vitest](https://vitest.dev/) for the `core` test suite
- No runtime dependencies beyond React — the physics/parsing engine is
  hand-written, dependency-free TypeScript.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which installs,
tests, type-checks, builds (with `VITE_BASE_PATH` set to `/<repo>/` so
assets resolve correctly under a GitHub Pages *project* site), and deploys
`dist/` to GitHub Pages.

## Status

This is a draft/experimental notation and engine (see the `NCIE v0 · draft`
badge in the app header) — there's no formal proof that the grammar
composes correctly for arbitrary `N`, and the current engine supports
exactly one signal (`PATH`) leg per program. Contributions/experiments
extending it are welcome.
