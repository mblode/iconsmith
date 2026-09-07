import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { expect, test } from "vitest";

import {
  collectCampaignEvidence,
  writeCampaignEvidence,
} from "./campaign-evidence.js";

test("retains missing slots and writes resumable byte-bound cross-master evidence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-cross-campaign-"));
  try {
    const requests = [16, 24].map((master) => ({
      concept: "folder-lock",
      destination: path.join(root, String(master)),
      family: "folder",
      master,
      requestId: String(master),
    }));
    const [request] = requests;
    const attempt = path.join(request.destination, "attempt-1");
    mkdirSync(attempt, { recursive: true });
    writeFileSync(
      path.join(request.destination, "request.json"),
      JSON.stringify({
        master: "16",
        nativeSize: 16,
        requestId: "16",
        selectedAttempt: attempt,
        status: "delivered",
      })
    );
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="2" y="2" width="12" height="12" rx="2"/></svg>';
    const native = await sharp(Buffer.from(svg)).png().toBuffer();
    for (const finish of ["outlined", "filled"]) {
      writeFileSync(path.join(attempt, `${finish}.svg`), svg);
      writeFileSync(path.join(attempt, `${finish}.native.png`), native);
    }
    mkdirSync(path.join(root, "receipts"));
    const requestBytes = readFileSync(
      path.join(request.destination, "request.json")
    );
    writeFileSync(
      path.join(root, "receipts", "16.json"),
      JSON.stringify({
        artifacts: ["outlined", "filled"].map((finish) => ({
          name: `${finish}.svg`,
          sha256: createHash("sha256").update(svg).digest("hex"),
        })),
        requestFileHash: createHash("sha256")
          .update(requestBytes)
          .digest("hex"),
        requestId: "16",
        terminal: JSON.parse(requestBytes.toString()),
      })
    );
    const collected = collectCampaignEvidence(requests);
    expect(collected.evidence).toHaveLength(2);
    expect(collected.missing).toHaveLength(2);
    const first = await writeCampaignEvidence(root, requests);
    expect(first.index).toMatchObject({
      aiQualified: false,
      requestedSlots: 4,
      status: "pending-independent-review",
    });
    const [entry] = first.index.entries;
    expect(entry.complete).toBe(false);
    expect(await writeCampaignEvidence(root, requests)).toEqual(first);
    const { receipt } = entry;
    writeFileSync(
      receipt,
      readFileSync(receipt, "utf-8").replace(
        '"pending-independent-review"',
        '"approved"'
      )
    );
    await expect(writeCampaignEvidence(root, requests)).rejects.toThrow(
      "changed"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects copied terminal identities before reading selected artifacts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-cross-identity-"));
  try {
    writeFileSync(
      path.join(root, "request.json"),
      JSON.stringify({
        nativeSize: 16,
        requestId: "other",
        status: "delivered",
      })
    );
    expect(() =>
      collectCampaignEvidence([
        {
          concept: "box",
          destination: root,
          family: "box",
          master: 16,
          requestId: "expected",
        },
      ])
    ).toThrow("identity");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects symlinked selected attempts and unreceipted evidence export", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "iconsmith-cross-scope-"));
  try {
    const destination = path.join(root, "request");
    const outside = path.join(root, "outside");
    mkdirSync(destination);
    mkdirSync(outside);
    const selectedAttempt = path.join(destination, "attempt-1");
    symlinkSync(outside, selectedAttempt);
    writeFileSync(
      path.join(destination, "request.json"),
      JSON.stringify({
        master: "16",
        nativeSize: 16,
        requestId: "scoped",
        selectedAttempt,
        status: "delivered",
      })
    );
    const requests = [
      {
        concept: "box",
        destination,
        family: "box",
        master: 16,
        requestId: "scoped",
      },
    ];
    expect(() => collectCampaignEvidence(requests)).toThrow("escaped");
    await expect(writeCampaignEvidence(root, requests)).rejects.toThrow(
      "validated campaign receipt"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
