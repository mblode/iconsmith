/**
 * `bench/calibration.v1.json` — the measured scales, read back.
 *
 * The file is a committed artifact written by `scripts/calibrate.ts`, carrying
 * the procedure and the date it was measured. It is deliberately **not** a set
 * of constants in a source file: constants drift away from the corpus that
 * justified them silently, and a floor nobody can re-derive is a floor nobody
 * should trust. Every number here is reproducible by re-running the script
 * against the same store.
 *
 * Absent or stale calibration degrades the same way absent embeddings do: the
 * panel reports `null` and says why. It never falls back to a guessed floor,
 * because a guessed floor is indistinguishable from a measured one in the
 * output and turns the whole report into fiction.
 */
import { existsSync, readFileSync } from "node:fs";

import type { PackRates } from "./conformance.js";
import type { GateResult } from "./judge.js";
import type { Separation } from "./separation.js";

interface StyleCalibration {
  baseline: number;
  baselineN: number;
  ceiling: number;
  ceilingN: number;
  floor: number;
  floorN: number;
  k: number;
  model: string;
  /** Whether the metric can tell its own baseline from its own floor. A metric
   *  that cannot is discarded, exactly as a judge that fails its gate is. */
  separation: Separation;
}

interface SemanticCalibration {
  /** Concepts in the bank the ranks are taken over. */
  bank: number;
  /** A third-party icon of the same concept, asked the same question — the
   *  honest "another professional set's take" target. */
  baseline: number;
  baselineMargin: number;
  baselineN: number;
  /** The real shipped icon's own rank@1. Not 1, and that is the point. */
  ceiling: number;
  ceilingMargin: number;
  ceilingN: number;
  floor: number;
  floorMargin: number;
  floorN: number;
  model: string;
  prompt: string;
  separation: Separation;
}

interface ConformanceCalibrationFile {
  baseline: { gate: number; set: string; strict: number };
  ceiling: { gate: number; n: number; set: string; strict: number };
  excluded: { reason: string; set: string }[];
  floor: { gate: number; n: number; sets: string[]; strict: number };
  packs: PackRates[];
}

/** A metric whose calibration could not be measured carries a note instead of
 *  numbers, so "not measured" survives into the report as a sentence rather
 *  than as a zero. */
export interface Unmeasured {
  note: string;
}

/** Every sanity-gate run the judge has been put through, passes and failures
 *  alike. A file holding only the model that passed would read as "the judge
 *  works" and hide that the cheap model does not. */
interface JudgeCalibration {
  procedure: string;
  runs: {
    gate: GateResult;
    measuredAt: string;
    missed: string[];
    model: string;
    seed: number;
  }[];
}

export interface Calibration {
  builtAt: string;
  conformance: ConformanceCalibrationFile;
  judge: JudgeCalibration | Unmeasured;
  procedure: Record<string, string>;
  records: number;
  sample: number;
  semantic: SemanticCalibration | Unmeasured;
  style: StyleCalibration | Unmeasured;
}

export const isMeasured = <T>(v: T | Unmeasured): v is T =>
  !(typeof v === "object" && v !== null && "note" in v);

/**
 * The `.v1.` is the **scale's** version, not the file format's.
 *
 * Re-measuring against a rebuilt store overwrites this file, because the
 * numbers still answer the same questions. Changing what a question *means* —
 * a different embedding model, a different k, a different definition of the
 * floor — makes every previously reported reach incomparable, and that gets a
 * `v2` beside this one rather than a quiet overwrite.
 */
const DEFAULT_CALIBRATION = "bench/calibration.v1.json";

/** Null when the file is absent — the degradation path on a fresh clone that
 *  has never run the calibration. */
export const loadCalibration = (
  file = DEFAULT_CALIBRATION
): Calibration | null =>
  existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf-8")) as Calibration)
    : null;
