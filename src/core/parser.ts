import { Complex } from "./complex";
import { NcieError } from "./types";
import type {
  AnalyzeInstruction,
  BellVariant,
  Condition,
  ExplicitTerm,
  Instruction,
  MeasInstruction,
  ParticleType,
  PathInstruction,
  Program,
  Outcome,
  SrcInstruction,
  StateSpec,
  Timing,
} from "./types";

const SRC_RE =
  /^SRC\(\s*([A-Za-z_]\w*)\s*\)\s*:\s*type=(\w+)\s*x\s*(\d+)\s*,\s*state=(.+)$/;
const LEG_RE = /^(leg\d+)\s*:\s*(PATH|MEAS)\((.*)\)\s*$/;
const ANALYZE_RE = /^ANALYZE\s*:\s*HIST\((.*)\)\s*$/;

const PARTICLE_TYPES: readonly ParticleType[] = [
  "photon",
  "electron",
  "neutron",
  "atom",
];

function stripComment(line: string): { code: string; comment?: string } {
  const idx = line.indexOf("//");
  if (idx === -1) return { code: line.trim() };
  const comment = line.slice(idx + 2).trim();
  return { code: line.slice(0, idx).trim(), comment };
}

function parseKeyValueList(raw: string, line: number): Map<string, string> {
  const out = new Map<string, string>();
  const parts = raw.length === 0 ? [] : raw.split(",");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      throw new NcieError(`invalid parameter: "${part.trim()}"`, line);
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    out.set(key, value);
  }
  return out;
}

function requireNumber(
  params: Map<string, string>,
  key: string,
  line: number,
): number {
  const raw = params.get(key);
  if (raw === undefined) {
    throw new NcieError(`missing required parameter: "${key}"`, line);
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new NcieError(`invalid numeric value for "${key}": "${raw}"`, line);
  }
  return value;
}

/** Accepts "0", "pi", "-pi/2", "pi/4", "3*pi/4", or a plain radian literal. */
export function parseAngle(raw: string, line: number): number {
  const s = raw.trim();
  const plain = Number(s);
  if (!Number.isNaN(plain) && s.length > 0) return plain;

  const m = /^(-)?\s*(\d+(?:\.\d+)?)?\s*\*?\s*pi\s*(?:\/\s*(\d+(?:\.\d+)?))?$/i.exec(
    s,
  );
  if (!m) {
    throw new NcieError(`invalid angle: "${raw}"`, line);
  }
  const sign = m[1] ? -1 : 1;
  const coeff = m[2] !== undefined ? Number(m[2]) : 1;
  const denom = m[3] !== undefined ? Number(m[3]) : 1;
  return (sign * coeff * Math.PI) / denom;
}

function parseOutcome(raw: string, line: number): Outcome {
  const s = raw.trim();
  if (s === "+1" || s === "1") return 1;
  if (s === "-1") return -1;
  throw new NcieError(
    `measurement outcome must be +1 or -1, received "${raw}"`,
    line,
  );
}

function parseExplicitState(
  inner: string,
  n: number,
  line: number,
): { kind: "explicit"; terms: ExplicitTerm[] } {
  const terms: ExplicitTerm[] = [];
  const rawTerms = inner.length === 0 ? [] : inner.split(",");
  for (const rawTerm of rawTerms) {
    const eq = rawTerm.indexOf("=");
    if (eq === -1) {
      throw new NcieError(`invalid explicit term: "${rawTerm.trim()}"`, line);
    }
    const bits = rawTerm.slice(0, eq).trim();
    const amp = rawTerm.slice(eq + 1).trim();
    if (bits.length !== n || !/^[0-9]+$/.test(bits)) {
      throw new NcieError(
        `index "${bits}" must have ${n} digits (one per leg)`,
        line,
      );
    }
    const indices = bits.split("").map((d) => Number(d));
    const amplitude = new Complex(Number(amp), 0);
    if (Number.isNaN(amplitude.re)) {
      throw new NcieError(`invalid amplitude: "${amp}"`, line);
    }
    terms.push({ indices, amplitude });
  }
  if (terms.length === 0) {
    throw new NcieError("explicit state needs at least one term", line);
  }
  return { kind: "explicit", terms };
}

function parseStateSpec(raw: string, n: number, line: number): StateSpec {
  const s = raw.trim();

  const bellMatch = /^Bell\(\s*(Phi\+|Phi-|Psi\+|Psi-)\s*\)$/.exec(s);
  if (bellMatch) {
    if (n !== 2) {
      throw new NcieError(`Bell state requires x2, received x${n}`, line);
    }
    return { kind: "bell", variant: bellMatch[1] as BellVariant };
  }

  if (/^GHZ(\(\s*\d+\s*\))?$/.test(s)) {
    if (n < 2) {
      throw new NcieError("GHZ state requires N>=2", line);
    }
    return { kind: "ghz" };
  }

  if (/^W(\(\s*\d+\s*\))?$/.test(s)) {
    if (n < 2) {
      throw new NcieError("W state requires N>=2", line);
    }
    return { kind: "w" };
  }

  if (s === "coherent") {
    return { kind: "coherent" };
  }

  const explicitMatch = /^explicit\((.*)\)$/.exec(s);
  if (explicitMatch) {
    return parseExplicitState(explicitMatch[1] ?? "", n, line);
  }

  throw new NcieError(`unknown state: "${raw}"`, line);
}

function parseSrc(code: string, line: number): SrcInstruction {
  const m = SRC_RE.exec(code);
  if (!m) {
    throw new NcieError(`malformed SRC instruction: "${code}"`, line);
  }
  const [, id, typeRaw, nRaw, stateRaw] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (!PARTICLE_TYPES.includes(typeRaw as ParticleType)) {
    throw new NcieError(
      `unknown particle type: "${typeRaw}" (use ${PARTICLE_TYPES.join(", ")})`,
      line,
    );
  }
  const n = Number(nRaw);
  const state = parseStateSpec(stateRaw, n, line);
  return {
    kind: "src",
    line,
    id,
    particleType: typeRaw as ParticleType,
    n,
    state,
  };
}

function parsePath(leg: string, paramsRaw: string, line: number): PathInstruction {
  const params = parseKeyValueList(paramsRaw, line);
  const slits = requireNumber(params, "slits", line);
  const spacing = requireNumber(params, "spacing", line);
  const width = requireNumber(params, "width", line);
  if (!Number.isInteger(slits) || slits < 2) {
    throw new NcieError("slits must be an integer >= 2", line);
  }
  return { kind: "path", line, leg, slits, spacing, width };
}

function parseMeas(leg: string, paramsRaw: string, line: number): MeasInstruction {
  const params = parseKeyValueList(paramsRaw, line);
  const basisRaw = params.get("basis");
  if (basisRaw === undefined) {
    throw new NcieError('missing required parameter: "basis"', line);
  }
  const basisTheta = parseAngle(basisRaw, line);
  const timingRaw = params.get("time");
  if (timingRaw !== undefined && timingRaw !== "before" && timingRaw !== "after") {
    throw new NcieError(`time must be "before" or "after": "${timingRaw}"`, line);
  }
  const timing = timingRaw as Timing | undefined;
  return timing === undefined
    ? { kind: "meas", line, leg, basisTheta }
    : { kind: "meas", line, leg, basisTheta, timing };
}

function parseAnalyze(
  inner: string,
  comment: string | undefined,
  line: number,
): AnalyzeInstruction {
  const [legPart, condPart] = inner.split("|").map((p) => p.trim());
  if (!legPart) {
    throw new NcieError("HIST needs a target leg", line);
  }
  const conditions: Condition[] = [];
  if (condPart) {
    for (const rawCond of condPart.split(",")) {
      const eq = rawCond.indexOf("=");
      if (eq === -1) {
        throw new NcieError(`invalid condition: "${rawCond.trim()}"`, line);
      }
      const leg = rawCond.slice(0, eq).trim();
      const outcome = parseOutcome(rawCond.slice(eq + 1), line);
      conditions.push({ leg, outcome });
    }
  }
  return comment === undefined
    ? { kind: "analyze", line, leg: legPart, conditions }
    : { kind: "analyze", line, leg: legPart, conditions, comment };
}

export function parseProgram(source: string): Program {
  const instructions: Instruction[] = [];
  const rawLines = source.split(/\r?\n/);

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const { code, comment } = stripComment(rawLines[i] ?? "");
    if (code.length === 0) continue;

    const srcMatch = code.startsWith("SRC(");
    const analyzeMatch = ANALYZE_RE.exec(code);
    const legMatch = LEG_RE.exec(code);

    if (srcMatch) {
      instructions.push(parseSrc(code, lineNo));
    } else if (legMatch) {
      const [, leg, op, params] = legMatch as unknown as [
        string,
        string,
        string,
        string,
      ];
      instructions.push(
        op === "PATH"
          ? parsePath(leg, params, lineNo)
          : parseMeas(leg, params, lineNo),
      );
    } else if (analyzeMatch) {
      const inner = analyzeMatch[1] ?? "";
      instructions.push(parseAnalyze(inner, comment, lineNo));
    } else {
      throw new NcieError(`unrecognized instruction: "${code}"`, lineNo);
    }
  }

  if (!instructions.some((i) => i.kind === "src")) {
    throw new NcieError("program needs a SRC instruction");
  }
  if (!instructions.some((i) => i.kind === "analyze")) {
    throw new NcieError("program needs at least one ANALYZE instruction");
  }

  return { source, instructions };
}
