import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type DurableWriteMode = "exclusive" | "replace";

const fsyncDirectory = (directory: string) => {
  const descriptor = openSync(directory, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

/** Commit complete JSON bytes under one filename. Exclusive mode never replaces
 * an existing identity; replace mode atomically advances a derived ledger. */
export const writeDurableJson = (
  file: string,
  value: unknown,
  mode: DurableWriteMode = "exclusive"
) => {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) {
    throw new Error("Durable JSON value is not serializable");
  }
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  let installed = false;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${json}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (mode === "exclusive") {
      linkSync(temporary, file);
    } else {
      renameSync(temporary, file);
    }
    installed = true;
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (mode === "exclusive" || !installed) {
      rmSync(temporary, { force: true });
      fsyncDirectory(directory);
    }
  }
};
