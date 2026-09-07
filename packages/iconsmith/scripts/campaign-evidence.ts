/** Materialize native cross-master evidence after canonical request delivery. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  readCrossMasterReview,
  writeCrossMasterReview,
} from "./cross-master-review.js";
import type { CrossMasterEvidence } from "./cross-master-review.js";

const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

interface Request {
  concept: string;
  destination: string;
  family: string;
  master: number;
  requestId: string;
}

// Keep terminal, missing-artifact and identity dispositions together.
// eslint-disable-next-line complexity
export const collectCampaignEvidence = (
  requests: readonly Request[],
  receiptsDirectory?: string
) => {
  const evidence: CrossMasterEvidence[] = [];
  const missing: {
    concept: string;
    finish: string;
    nativeSize: number;
    reason: string;
    requestId: string;
  }[] = [];
  const receipts: { requestId: string; hash: string | null }[] = [];
  for (const request of requests) {
    const file = path.join(request.destination, "request.json");
    const bytes = existsSync(file) ? readFileSync(file) : null;
    receipts.push({
      hash: bytes ? digest(bytes) : null,
      requestId: request.requestId,
    });
    const terminal = bytes ? JSON.parse(bytes.toString()) : null;
    if (
      terminal &&
      (terminal.requestId !== request.requestId ||
        terminal.nativeSize !== request.master)
    ) {
      throw new Error("Cross-master request identity mismatch");
    }
    if (terminal && terminal.master !== String(request.master)) {
      throw new Error("Cross-master request identity mismatch");
    }
    if (terminal && receiptsDirectory) {
      const receiptFile = path.join(
        receiptsDirectory,
        `${request.requestId}.json`
      );
      if (!existsSync(receiptFile)) {
        throw new Error(
          "Cross-master terminal lacks validated campaign receipt"
        );
      }
      const receipt = JSON.parse(readFileSync(receiptFile, "utf-8"));
      if (
        receipt.requestId !== request.requestId ||
        receipt.requestFileHash !== digest(bytes ?? "") ||
        canonical(receipt.terminal) !== canonical(terminal)
      ) {
        throw new Error("Cross-master campaign receipt identity mismatch");
      }
    }
    const selected = terminal?.selectedAttempt;
    let selectedReal = "";
    let destination = "";
    if (selected) {
      destination = realpathSync(request.destination);
      selectedReal = realpathSync(selected);
      const relative = path.relative(destination, selectedReal);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
          "Cross-master selected artifact escaped request directory"
        );
      }
      for (const finish of ["outlined", "filled"] as const) {
        for (const suffix of ["svg", "native.png"] as const) {
          const artifact = path.join(selectedReal, `${finish}.${suffix}`);
          if (existsSync(artifact)) {
            const artifactRelative = path.relative(
              destination,
              realpathSync(artifact)
            );
            if (
              artifactRelative.startsWith("..") ||
              path.isAbsolute(artifactRelative)
            ) {
              throw new Error(
                "Cross-master artifact escaped request directory"
              );
            }
          }
        }
      }
      if (terminal.status === "delivered" && receiptsDirectory) {
        const receipt = JSON.parse(
          readFileSync(
            path.join(receiptsDirectory, `${request.requestId}.json`),
            "utf-8"
          )
        );
        const hashes = new Map(
          (Array.isArray(receipt.artifacts) ? receipt.artifacts : []).map(
            (artifact: { name?: unknown; sha256?: unknown }) => [
              artifact.name,
              artifact.sha256,
            ]
          )
        );
        for (const finish of ["outlined", "filled"] as const) {
          const artifact = path.join(selectedReal, `${finish}.svg`);
          if (hashes.get(`${finish}.svg`) !== digest(readFileSync(artifact))) {
            throw new Error("Cross-master delivered artifact receipt mismatch");
          }
        }
      }
    }
    for (const finish of ["outlined", "filled"] as const) {
      const svgFile = selected ? path.join(selected, `${finish}.svg`) : "";
      const nativeImageFile = selected
        ? path.join(selected, `${finish}.native.png`)
        : "";
      if (
        terminal?.status !== "delivered" ||
        !existsSync(svgFile) ||
        !existsSync(nativeImageFile)
      ) {
        missing.push({
          concept: request.concept,
          finish,
          nativeSize: request.master,
          reason: terminal?.status ?? "not-run",
          requestId: request.requestId,
        });
        continue;
      }
      if (request.master !== 16 && request.master !== 24) {
        throw new Error("Unsupported native master");
      }
      evidence.push({
        concept: request.concept,
        family: request.family,
        finish,
        nativeImageFile,
        nativeImageSha256: digest(readFileSync(nativeImageFile)),
        nativeSize: request.master,
        svgFile,
        svgSha256: digest(readFileSync(svgFile)),
      });
    }
  }
  return { evidence, missing, receipts };
};

/** New request hashes create a new immutable evidence revision. No provider calls. */
export const writeCampaignEvidence = async (
  out: string,
  requests: readonly Request[]
) => {
  const collected = collectCampaignEvidence(
    requests,
    path.join(out, "receipts")
  );
  const hash = digest(JSON.stringify(collected));
  const directory = path.join(out, `cross-master-${hash}`);
  const indexFile = path.join(directory, "index.json");
  const resumed = existsSync(directory);
  if (!resumed) {
    mkdirSync(directory, { recursive: false });
  }
  const families = [
    ...new Set(collected.evidence.map((row) => row.family)),
  ].toSorted();
  const entries = [];
  for (const family of families) {
    const packet = path.join(directory, digest(family).slice(0, 16));
    // Each family is bounded to four native members and retained independently.
    /* eslint-disable no-await-in-loop -- Bound one family packet at a time. */
    const result = resumed
      ? await readCrossMasterReview(path.join(packet, "receipt.json"))
      : await writeCrossMasterReview(
          packet,
          collected.evidence.filter((row) => row.family === family)
        );
    /* eslint-enable no-await-in-loop */
    entries.push({
      complete: result.complete,
      family,
      hash: result.hash,
      receipt: path.join(packet, "receipt.json"),
      reviewImage: path.join(packet, "review.png"),
    });
  }
  const index = {
    aiQualified: false,
    entries,
    evidenceHash: hash,
    missing: collected.missing,
    requestedSlots: requests.length * 2,
    status: "pending-independent-review",
  };
  if (resumed) {
    if (
      !existsSync(indexFile) ||
      readFileSync(indexFile, "utf-8") !== `${JSON.stringify(index, null, 2)}\n`
    ) {
      throw new Error("Cross-master campaign index changed or incomplete");
    }
  } else {
    writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`, {
      flag: "wx",
    });
  }
  return { index, indexFile };
};
