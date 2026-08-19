/**
 * Reading embedding sidecars, and doing without them.
 *
 * Style and semantic fidelity need a vision model. A vision model needs an
 * ONNX or PyTorch runtime, and **that runtime is not a dependency of this
 * package**. `npm install` has to keep working on a machine with no Python, so
 * embedding is a batch sidecar stage — `scripts/embed.py`, run by hand, writing
 * fixed-width `.f32` files beside the record store in exactly the format
 * `corpus/build.ts` already uses for fingerprints and ink.
 *
 * The contract this module holds is therefore: **absent embeddings report
 * `null`, never throw and never zero.** A metric that could not be computed and
 * a metric that scored 0 are different facts, and a panel that flattens them
 * into one number tells a reader the pipeline failed when in fact nothing was
 * measured.
 *
 * A sidecar is `rows × dim` little-endian float32 with no header — the header
 * lives in the JSON index beside it, which also carries the row order as ids.
 * `corpus/build.ts` addresses rows by a `{file, row}` stamped into each record;
 * these sidecars are written by a separate stage that cannot stamp anything
 * into a store it does not own, so they carry their own id list instead.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The JSON index written beside every `.f32` this module reads. */
export interface EmbeddingIndex {
  /** Row order. `ids[i]` is the identity in row `i`. */
  ids: string[];
  /** Rows are L2-normalised at write time, so `cosine` is a dot product and a
   *  stale un-normalised file is detectable rather than silently wrong. */
  normalised: true;
  /** Model id, so a panel calibrated against DINO is never read against a file
   *  a later run wrote with something else. */
  model: string;
  dim: number;
  /** ISO date the sidecar was written. */
  builtAt: string;
}

export interface Embeddings {
  builtAt: string;
  dim: number;
  /** The unit vector for an id, or null when the id is not in the file. */
  get: (id: string) => Float32Array | null;
  has: (id: string) => boolean;
  ids: readonly string[];
  model: string;
  rows: number;
}

/** Thrown when a sidecar exists but cannot be trusted. Absent is fine and
 *  reports null; *present and inconsistent* is a bug that must be loud, because
 *  a mis-sized read returns plausible floats from the wrong icon. */
export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

const FLOAT_BYTES = 4;

/**
 * Load `<dir>/<name>.f32` and `<dir>/<name>.json`.
 *
 * Null when either is missing — that is the degradation path and the common
 * case on a machine that has never run the embed stage. Throws only when the
 * pair is present and disagrees with itself.
 */
export const loadEmbeddings = (
  dir: string,
  name: string
): Embeddings | null => {
  const data = path.join(dir, `${name}.f32`);
  const index = path.join(dir, `${name}.json`);
  if (!(existsSync(data) && existsSync(index))) {
    return null;
  }
  const meta = JSON.parse(readFileSync(index, "utf-8")) as EmbeddingIndex;
  const bytes = statSync(data).size;
  const expected = meta.ids.length * meta.dim * FLOAT_BYTES;
  if (bytes !== expected) {
    throw new EmbeddingError(
      `${data} is ${bytes} bytes; ${index} describes ${meta.ids.length} rows × ${meta.dim} floats = ${expected}. ` +
        "A mis-sized sidecar does not fail to read, it reads the wrong icon's vector and " +
        "returns a plausible number. Re-run `scripts/embed.py`."
    );
  }
  if (meta.normalised !== true) {
    throw new EmbeddingError(
      `${index} does not declare its rows normalised. Every consumer here treats ` +
        "a dot product as a cosine; un-normalised rows would make every similarity wrong " +
        "by an unknown factor rather than visibly broken."
    );
  }
  const buffer = readFileSync(data);
  const all = new Float32Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
  );
  const rowOf = new Map(meta.ids.map((id, i) => [id, i]));
  return {
    builtAt: meta.builtAt,
    dim: meta.dim,
    get: (id) => {
      const row = rowOf.get(id);
      return row === undefined
        ? null
        : all.subarray(row * meta.dim, (row + 1) * meta.dim);
    },
    has: (id) => rowOf.has(id),
    ids: meta.ids,
    model: meta.model,
    rows: meta.ids.length,
  };
};

/** Cosine of two unit vectors, i.e. their dot product. Not a general cosine:
 *  it assumes `loadEmbeddings` checked `normalised`. */
export const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
};

/**
 * Embed an SVG that has no row in any sidecar — a freshly generated icon.
 *
 * There is deliberately no in-process implementation. The runtime is not a
 * dependency, so a treatment vector arrives the same way the corpus vectors do:
 * `scripts/embed.py` is pointed at a directory of candidate SVGs and writes a
 * sidecar the eval then loads. A caller with no sidecar for its candidates gets
 * `null` treatments and a panel that says so.
 */
export const TREATMENT_SIDECAR_NOTE =
  "Treatment vectors come from the same batch stage as the corpus vectors: run " +
  "`scripts/embed.py --svg-dir <candidates> --out <dir>/<name>` and pass the " +
  "result in. There is no in-process embedder, because that would put a model " +
  "runtime in `dependencies`.";
