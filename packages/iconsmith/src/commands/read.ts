import { readFileSync, statSync } from "node:fs";

/**
 * File reads that fail in the caller's language, not Node's.
 *
 * `readFileSync` surfaces `ENOENT: no such file or directory, open '/x.svg'`,
 * which names the syscall rather than the mistake and offers nothing to do
 * next. Every command here already knows what kind of file it wanted, so it can
 * say so and say what to pass instead. The original error is kept as `cause`,
 * so nothing is lost for anyone debugging the tool itself.
 */
export class InputError extends Error {
  readonly code = "INPUT";
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "InputError";
    this.cause = cause;
  }
}

const explain = (file: string, kind: string, error: unknown): InputError => {
  const errno = (error as NodeJS.ErrnoException).code;
  if (errno === "ENOENT") {
    return new InputError(
      `Cannot read "${file}": no such file. Pass a path to ${kind}.`,
      error
    );
  }
  if (errno === "EISDIR") {
    return new InputError(
      `Cannot read "${file}": that is a directory. Pass ${kind}, or a glob such as "${file}/*.svg".`,
      error
    );
  }
  if (errno === "EACCES") {
    return new InputError(
      `Cannot read "${file}": permission denied. Check the file's permissions.`,
      error
    );
  }
  return new InputError(
    `Cannot read "${file}": ${(error as Error).message}`,
    error
  );
};

/** Read a text file, or fail naming the file, the kind wanted, and the fix. */
export const readText = (file: string, kind: string): string => {
  try {
    return readFileSync(file, "utf-8");
  } catch (error) {
    throw explain(file, kind, error);
  }
};

/** Read and parse JSON, separating "cannot read" from "is not JSON" — they
 *  have different fixes and a single message conflates them. */
export const readJson = <T>(file: string, kind: string): T => {
  const text = readText(file, kind);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new InputError(
      `"${file}" is not valid JSON: ${(error as Error).message}. Expected ${kind}.`,
      error
    );
  }
};

/** Refuse to overwrite silently. A generated icon is cheap to redo; the file it
 *  would land on may not be. */
export const assertWritable = (file: string, force: boolean): void => {
  if (force) {
    return;
  }
  try {
    statSync(file);
  } catch {
    // Nothing there — the normal case.
    return;
  }
  throw new InputError(
    `"${file}" already exists. Pass --force to overwrite it, or choose another path.`
  );
};
