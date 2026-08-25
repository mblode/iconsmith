/**
 * Host-side look at a drawing. The model never sees coordinates; these pin
 * the sanitizer, the PNG sidecar, the JSON sidecar, and the fail-open ask
 * seam. Nothing here talks to a gateway: `ask` is injected.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { AuditAsk, AuditFinding, AuditResult } from "./audit.js";
import {
  AUDIT_FILE,
  PREVIEW_FILE,
  audit,
  lookBrief,
  persistLook,
  sanitizeFinding,
  sanitizeReason,
  shot,
  writeAudit,
  writePreview,
} from "./audit.js";
import { MARK_TWINS } from "./kind.js";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#000"/></svg>';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const REDACTED =
  "finding named geometry; rewrite the program, do not copy path data";

const concept = { name: "box" };

const scratch = () => mkdtempSync(path.join(tmpdir(), "iconsmith-audit-"));

const finding = (message: string, kind: AuditFinding["kind"] = "object") => ({
  kind,
  message,
});

const fromAsk =
  (over: Partial<AuditResult> & { findings: AuditFinding[] }): AuditAsk =>
  () =>
    Promise.resolve({
      ok: false,
      pq: 8,
      reason: null,
      sc: 8,
      ...over,
    });

describe("sanitizeFinding", () => {
  it("replaces a message that names path data", () => {
    for (const message of [
      "close the lid with M4 4H12",
      "the stem is d=M4 4H12",
      "do not emit <path here",
    ]) {
      expect(sanitizeFinding(finding(message))).toEqual({
        kind: "object",
        message: REDACTED,
      });
    }
  });

  it("leaves a clean message alone", () => {
    const clean = finding("the weight is too light for the set", "weight");
    expect(sanitizeFinding(clean)).toEqual(clean);
  });
});

describe("shot and writePreview", () => {
  it("writes a real PNG into the scratch directory as PREVIEW.png", async () => {
    const dir = scratch();
    const preview = await writePreview(dir, SVG);
    expect(preview.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(readFileSync(path.join(dir, PREVIEW_FILE)).subarray(0, 4)).toEqual(
      PNG_MAGIC
    );
    const raster = await shot(SVG);
    expect(raster.subarray(0, 4)).toEqual(PNG_MAGIC);
  });
});

describe("persistLook", () => {
  it("writes slugged sidecars beside a staged svg", async () => {
    const dir = scratch();
    const result: AuditResult = {
      findings: [],
      ok: true,
      pq: 8,
      reason: null,
      sc: 8,
      scorable: true,
      stage: "decide",
    };
    await persistLook(dir, "plus", SVG, result);
    expect(
      readFileSync(path.join(dir, "plus.preview.png")).subarray(0, 4)
    ).toEqual(PNG_MAGIC);
    expect(
      JSON.parse(readFileSync(path.join(dir, "plus.audit.json"), "utf-8"))
    ).toEqual(result);
  });
});

describe("writeAudit", () => {
  it("writes AUDIT.json that round-trips", () => {
    const dir = scratch();
    const result: AuditResult = {
      findings: [finding("the middle is empty", "empty")],
      ok: false,
      pq: 5,
      reason: "empty centre",
      sc: 4,
      scorable: true,
      stage: "screen",
    };
    writeAudit(dir, result);
    expect(
      JSON.parse(readFileSync(path.join(dir, AUDIT_FILE), "utf-8"))
    ).toEqual(result);
  });
});

describe("audit", () => {
  it("uses the injected ask and fails when it returns findings", async () => {
    let calls = 0;
    const result = await audit({
      ask: ({ concept: seen, preview }) => {
        calls += 1;
        expect(seen).toEqual(concept);
        expect(preview.subarray(0, 4)).toEqual(PNG_MAGIC);
        return Promise.resolve({
          findings: [finding("not a box")],
          ok: true,
          pq: 9,
          reason: "wrong object",
          sc: 2,
        });
      },
      concept,
      svg: SVG,
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([finding("not a box")]);
  });

  it("passes when ask returns no findings and sc/pq are at least 6", async () => {
    const result = await audit({
      ask: fromAsk({ findings: [], pq: 6, reason: null, sc: 6 }),
      concept,
      svg: SVG,
    });
    expect(result.ok).toBe(true);
    expect(result.scorable).toBe(true);
    expect(result.stage).toBe("decide");
    expect(result.findings).toEqual([]);
    expect(result.sc).toBe(6);
    expect(result.pq).toBe(6);
  });

  it("lets a mark pass the screen with findings that do not drop SC/PQ", async () => {
    const result = await audit({
      ask: fromAsk({
        findings: [finding("a hair heavier than the set", "weight")],
        pq: 8,
        reason: "weight nit",
        sc: 9,
      }),
      concept,
      kind: "mark",
      svg: SVG,
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("screen");
    expect(result.findings).toHaveLength(1);
  });

  it("fail-opens as unscorable when ask throws, and does not throw", async () => {
    const result = await audit({
      ask: () => {
        throw new Error("gateway down");
      },
      concept,
      svg: SVG,
    });
    expect(result.ok).toBe(false);
    expect(result.scorable).toBe(false);
    expect(result.cost).toMatchObject({
      calls: 1,
      operation: "visual-audit",
      source: "unpriced",
      usd: null,
    });
    expect(result.findings).toEqual([]);
    expect(result.reason).toMatch(/audit failed/u);
  });

  it("propagates cancellation instead of converting it to an unscorable audit", async () => {
    const controller = new AbortController();
    await expect(
      audit({
        abortSignal: controller.signal,
        ask: ({ abortSignal }) => {
          expect(abortSignal).toBe(controller.signal);
          controller.abort();
          throw new Error("provider noticed cancellation");
        },
        concept,
        svg: SVG,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sanitizes findings that come back with path data", async () => {
    const result = await audit({
      ask: fromAsk({
        findings: [finding("redraw as M4 4H12", "gap")],
        pq: 4,
        reason: "named geometry",
        sc: 4,
      }),
      concept,
      svg: SVG,
    });
    expect(result.findings).toEqual([finding(REDACTED, "gap")]);
    expect(result.ok).toBe(false);
  });
});

describe("lookBrief", () => {
  it("tells the look that an outlined bar may be solid", () => {
    const brief = lookBrief({
      concept: { name: "minus" },
      finish: "outlined",
      kind: "mark",
      twin: MARK_TWINS.minus,
    });
    expect(brief).toMatch(/bar, line, or dot may be solid/u);
    expect(brief).toMatch(/Do not fail a minus/u);
  });
});

const scrubbed = (message: string): boolean =>
  sanitizeFinding({ kind: "belong", message }).message.startsWith(
    "finding named geometry"
  );

describe("the geometry scrubber", () => {
  it("still catches path data and path markup", () => {
    for (const message of [
      'd ="M4 11"',
      'd="M4 4H12"',
      '<path d="M0 0"',
      "the stem should run M4 4H12 across",
      "M12 2L20 20Z",
    ]) {
      expect(scrubbed(message)).toBe(true);
    }
  });

  /**
   * The rule it replaced was `[CcLlHhVvSsQqTtAa]\s*-?\d`, which fires on any
   * word ending in one of those letters before a number — so it ate the rubric
   * its own prompt asks for. `harness.ts` feeds this text to the repair agent
   * verbatim, so a scrubbed finding buys a paid turn that says nothing.
   */
  it("does not eat ordinary rubric language containing a number", () => {
    for (const message of [
      "The stroke does not survive at 24px",
      "It reads at 16px but the corner is crowded",
      "the ring is 2 units thick",
      "the icon has 3 parts",
      "PQ 6 is generous here",
      "a 24px stroke is too heavy",
      "the notch at 3 o clock is crowded",
      "SC 4 because the pole is lopsided",
    ]) {
      expect(scrubbed(message), message).toBe(false);
    }
  });

  it("holds `reason` to the same rule, since the repair agent is told to read it", () => {
    expect(sanitizeReason("the stem should run M4 4H12")).toBe(
      "reason named geometry; it was withheld so it cannot be copied"
    );
    expect(sanitizeReason("the bowl is crowded at 16px")).toBe(
      "the bowl is crowded at 16px"
    );
    expect(sanitizeReason(null)).toBeNull();
  });
});
