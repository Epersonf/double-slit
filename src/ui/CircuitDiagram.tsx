import type { LegInfo, Program, StateSpec } from "../core/types";
import { formatTheta } from "./format";

interface CircuitDiagramProps {
  readonly program: Program;
  readonly legs: readonly LegInfo[];
}

function describeState(state: StateSpec): string {
  switch (state.kind) {
    case "bell":
      return `Bell(${state.variant})`;
    case "ghz":
      return "GHZ(N)";
    case "w":
      return "W(N)";
    case "coherent":
      return "coherent";
    case "explicit":
      return `explicit(${state.terms.length} terms)`;
  }
}

export function CircuitDiagram({ program, legs }: CircuitDiagramProps) {
  const src = program.instructions.find((i) => i.kind === "src");
  if (!src || src.kind !== "src") return null;

  return (
    <div className="circuit">
      <div className="circuit__row circuit__row--src">
        <span className="circuit__tag">SRC</span>
        <span>
          {src.particleType} x{src.n} · {describeState(src.state)}
        </span>
      </div>
      {legs.map((leg) => (
        <div className="circuit__row" key={leg.name}>
          <span className="circuit__leg">{leg.name}</span>
          {leg.isSignal && leg.path ? (
            <span className="circuit__chain">
              <span className="circuit__tag circuit__tag--path">PATH</span>
              <span className="circuit__detail">
                slits={leg.path.slits} spacing={leg.path.spacing} width={leg.path.width}
              </span>
              <span className="circuit__arrow">&rarr;</span>
              <span className="circuit__tag circuit__tag--screen">SCREEN</span>
            </span>
          ) : leg.meas ? (
            <span className="circuit__chain">
              <span className="circuit__tag circuit__tag--meas">MEAS</span>
              <span className="circuit__detail">
                basis={formatTheta(leg.meas.basisTheta)}
                {leg.meas.timing ? ` · ${leg.meas.timing}` : ""}
              </span>
            </span>
          ) : (
            <span className="circuit__detail circuit__detail--dim">not measured (traced out)</span>
          )}
        </div>
      ))}
    </div>
  );
}
