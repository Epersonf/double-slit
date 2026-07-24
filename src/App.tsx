import { useMemo, useState } from "react";
import "./App.css";
import { EXAMPLES } from "./core/examples";
import { parseProgram } from "./core/parser";
import { compileProgram, runProgram } from "./core/simulate";
import { NcieError } from "./core/types";
import { AnalyzePanel } from "./ui/AnalyzePanel";
import { CircuitDiagram } from "./ui/CircuitDiagram";
import { CodeEditor } from "./ui/CodeEditor";
import { ExamplePicker } from "./ui/ExamplePicker";
import { ExperimentStage } from "./ui/ExperimentStage";
import { conditionLabel } from "./ui/format";
import { useExperimentPlayer } from "./ui/useExperimentPlayer";

const INITIAL_EXAMPLE = EXAMPLES[1]!;
const MIN_ROUNDS = 100;
const MAX_ROUNDS = 20000;

function App() {
  const [source, setSource] = useState(INITIAL_EXAMPLE.source);
  const [activeExampleId, setActiveExampleId] = useState<string | null>(INITIAL_EXAMPLE.id);
  const [seed, setSeed] = useState(1);
  const [totalRounds, setTotalRounds] = useState(3000);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  const evaluation = useMemo(() => {
    try {
      const program = parseProgram(source);
      const result = runProgram(program);
      const compiled = compileProgram(program);
      return { ok: true as const, program, result, compiled };
    } catch (e) {
      const error =
        e instanceof NcieError ? e : new NcieError(e instanceof Error ? e.message : String(e));
      return { ok: false as const, error };
    }
  }, [source]);

  const player = useExperimentPlayer(evaluation.ok ? evaluation.compiled : null, seed, totalRounds);
  const { hits, revealed, total } = player;

  const histograms = evaluation.ok ? evaluation.result.histograms : [];
  const safeFocusedIndex =
    focusedIndex !== null && focusedIndex < histograms.length ? focusedIndex : null;
  const focusedHistogram = safeFocusedIndex !== null ? histograms[safeFocusedIndex] : undefined;

  return (
    <div className="app">
      <header className="header">
        <div className="header__title-row">
          <h1 className="header__title">
            DOUBLE SLIT VISUALIZER<span className="header__cursor">_</span>
          </h1>
          <div className="header__badge">NCIE v0 · draft</div>
        </div>
        <p className="header__subtitle">
          notation for interference and entanglement circuits — executable interpreter
        </p>
      </header>

      <main className="layout">
        <section className="column column--left">
          <div className="panel">
            <div className="panel__title">[ EXAMPLES ]</div>
            <ExamplePicker
              activeId={activeExampleId}
              onSelect={(id) => {
                const ex = EXAMPLES.find((e) => e.id === id);
                if (!ex) return;
                setSource(ex.source);
                setActiveExampleId(id);
              }}
            />
          </div>

          <div className="panel panel--grow">
            <div className="panel__title">[ PROGRAM.NCIE ]</div>
            <CodeEditor
              value={source}
              onChange={(v) => {
                setSource(v);
                setActiveExampleId(null);
              }}
              {...(!evaluation.ok && evaluation.error.line !== undefined
                ? { errorLine: evaluation.error.line }
                : {})}
            />
            <div className={evaluation.ok ? "status status--ok" : "status status--error"}>
              {evaluation.ok
                ? `OK — ${evaluation.result.legs.length} legs, ${evaluation.result.histograms.length} ANALYZE`
                : `ERROR${evaluation.error.line ? ` (line ${evaluation.error.line})` : ""}: ${evaluation.error.message}`}
            </div>
          </div>

          <div className="panel">
            <div className="panel__title">[ ROUNDS ]</div>
            <div className="rounds">
              <div className="rounds__bar">
                <div
                  className="rounds__fill"
                  style={{ width: `${total > 0 ? (revealed / total) * 100 : 0}%` }}
                />
              </div>
              <div className="rounds__readout">
                {revealed} / {total} rounds · seed #{seed} · {player.speed.toFixed(1)}/s
                {player.playing ? "" : " · paused"}
              </div>
              <label className="rounds__total">
                TOTAL ROUNDS
                <input
                  type="number"
                  min={MIN_ROUNDS}
                  max={MAX_ROUNDS}
                  step={100}
                  value={totalRounds}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      setTotalRounds(Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(v))));
                    }
                  }}
                />
              </label>
              <button type="button" className="rounds__restart" onClick={() => setSeed((s) => s + 1)}>
                ▶ RESTART SIMULATION
              </button>
            </div>
          </div>

          {evaluation.ok && (
            <div className="panel">
              <div className="panel__title">[ CIRCUIT ]</div>
              <CircuitDiagram program={evaluation.program} legs={evaluation.result.legs} />
            </div>
          )}
        </section>

        <section className="column column--right">
          <ExperimentStage
            compiled={evaluation.ok ? evaluation.compiled : null}
            hits={hits}
            revealed={revealed}
            speed={player.speed}
            playing={player.playing}
            onTogglePlay={player.togglePlaying}
            onStep={player.step}
            onSpeedChange={player.setSpeed}
            focusConditions={focusedHistogram ? focusedHistogram.instruction.conditions : null}
            focusLabel={focusedHistogram ? conditionLabel(focusedHistogram.instruction) : "all rounds"}
            onClearFocus={() => setFocusedIndex(null)}
          />

          {evaluation.ok ? (
            evaluation.result.histograms.map((h, i) => (
              <AnalyzePanel
                key={i}
                histogram={h}
                hits={hits}
                revealed={revealed}
                focused={safeFocusedIndex === i}
                onClick={() => setFocusedIndex(safeFocusedIndex === i ? null : i)}
              />
            ))
          ) : (
            <div className="panel panel--error-full">
              <div className="panel__title">[ COMPILE ERROR ]</div>
              <pre className="error-detail">
                {evaluation.error.line ? `line ${evaluation.error.line}: ` : ""}
                {evaluation.error.message}
              </pre>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        notation draft — there is no formal proof that the grammar composes for
        arbitrary N. See notacao-circuitos-emaranhamento.pdf, Section 7.
      </footer>
    </div>
  );
}

export default App;
