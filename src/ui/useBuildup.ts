import { useEffect, useMemo, useState } from "react";
import { sampleHits } from "../core/hits";
import type { CompiledProgram } from "../core/simulate";
import type { Hit } from "../core/types";

const TOTAL_HITS = 4000;
const DURATION_MS = 7000;
export const BUILDUP_Y_RANGE = { min: -150, max: 150 } as const;

interface BuildupState {
  readonly hits: readonly Hit[];
  readonly revealed: number;
}

/** Drives the "many rounds" buildup animation: samples a fixed batch of hits
 * once per (program, seed), then reveals them linearly over DURATION_MS so every
 * ANALYZE panel animates in lockstep off the same underlying stream of rounds. */
export function useBuildup(compiled: CompiledProgram | null, seed: number) {
  const hits: readonly Hit[] = useMemo(() => {
    if (!compiled) return [];
    return sampleHits(compiled, TOTAL_HITS, seed, {
      min: BUILDUP_Y_RANGE.min,
      max: BUILDUP_Y_RANGE.max,
      resolution: 241,
    });
  }, [compiled, seed]);

  // Reset the revealed counter during render (not in an effect) whenever a new
  // hit batch arrives — React's documented pattern for "adjusting state when a
  // prop changes" without an extra render round-trip.
  const [state, setState] = useState<BuildupState>(() => ({ hits, revealed: 0 }));
  if (state.hits !== hits) {
    setState({ hits, revealed: 0 });
  }

  useEffect(() => {
    if (hits.length === 0) return undefined;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const frac = Math.min(1, (now - start) / DURATION_MS);
      const revealed = Math.floor(frac * hits.length);
      setState((s) => (s.hits === hits ? { hits, revealed } : s));
      if (frac < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hits]);

  return { hits: state.hits, revealed: state.revealed, total: hits.length };
}
