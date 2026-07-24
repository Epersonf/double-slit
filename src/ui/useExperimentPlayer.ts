import { useEffect, useMemo, useRef, useState } from "react";
import { sampleHits } from "../core/hits";
import type { CompiledProgram } from "../core/simulate";
import type { Hit } from "../core/types";

export const SCREEN_Y_RANGE = { min: -150, max: 150 } as const;

interface PlayerState {
  readonly hits: readonly Hit[];
  readonly revealed: number;
}

export interface ExperimentPlayer {
  readonly hits: readonly Hit[];
  readonly revealed: number;
  readonly total: number;
  readonly speed: number;
  readonly playing: boolean;
  readonly setSpeed: (speed: number) => void;
  readonly togglePlaying: () => void;
  readonly step: () => void;
}

/** Single source of truth for "the experiment": samples one batch of `totalRounds`
 * hits per (program, seed), then reveals them at a user-controlled pace (particles
 * per second). Every consumer — the apparatus animation, the round counter, and
 * every ANALYZE panel's buildup — reads the same `hits`/`revealed` pair, so they
 * can never drift apart the way two independently-paced timers would. */
export function useExperimentPlayer(
  compiled: CompiledProgram | null,
  seed: number,
  totalRounds: number,
): ExperimentPlayer {
  const hits: readonly Hit[] = useMemo(() => {
    if (!compiled) return [];
    return sampleHits(compiled, totalRounds, seed, {
      min: SCREEN_Y_RANGE.min,
      max: SCREEN_Y_RANGE.max,
      resolution: 241,
    });
  }, [compiled, seed, totalRounds]);

  const [speed, setSpeed] = useState(3);
  const [playing, setPlaying] = useState(true);
  const speedRef = useRef(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Reset playback during render (not in an effect) whenever a new hit batch
  // arrives — see useExperimentPlayer's sibling components for the same pattern.
  const [state, setState] = useState<PlayerState>(() => ({ hits, revealed: 0 }));
  if (state.hits !== hits) {
    setState({ hits, revealed: 0 });
  }

  useEffect(() => {
    if (hits.length === 0) return undefined;

    let raf = 0;
    let last = performance.now();
    let fractional = 0;

    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      if (playingRef.current) {
        fractional += dt * speedRef.current;
        const advance = Math.floor(fractional);
        if (advance > 0) {
          fractional -= advance;
          setState((s) =>
            s.hits === hits
              ? { hits, revealed: Math.min(hits.length, s.revealed + advance) }
              : s,
          );
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hits]);

  return {
    hits: state.hits,
    revealed: state.revealed,
    total: hits.length,
    speed,
    playing,
    setSpeed,
    togglePlaying: () => setPlaying((p) => !p),
    step: () =>
      setState((s) =>
        s.revealed < s.hits.length ? { hits: s.hits, revealed: s.revealed + 1 } : s,
      ),
  };
}
