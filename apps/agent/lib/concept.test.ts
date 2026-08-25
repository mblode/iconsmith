import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { conceptOf, isVague, slugOf, tokensOf } from "./concept.ts";
import { studioRequestSchema } from "@iconsmith/contract/types";

const BENCH = path.join(
  import.meta.dirname,
  "../../../packages/iconsmith/bench/reconstruction.json",
);
const HOUSE = path.join(import.meta.dirname, "../data/house-icons.json");

describe("tokensOf", () => {
  /**
   * The filter used to be a bare `length >= 3`, which is a proxy for "filler"
   * that this set's vocabulary breaks: a digit is how a variant is named, and
   * a negation is the whole meaning.
   */
  it("keeps digits, negations and directions", () => {
    assert.deepEqual(tokensOf("wifi no signal"), ["wifi", "no", "signal"]);
    assert.deepEqual(tokensOf("bell 2 off"), ["bell", "2", "off"]);
    assert.deepEqual(tokensOf("arrow up wall"), ["arrow", "up", "wall"]);
    assert.deepEqual(tokensOf("ai slop"), ["ai", "slop"]);
  });

  it("still drops intent filler", () => {
    assert.deepEqual(tokensOf("draw me a nice icon for the inbox"), ["inbox"]);
  });
});

describe("conceptOf over the sealed benchmark", () => {
  const entries = (
    JSON.parse(readFileSync(BENCH, "utf-8")) as {
      entries: { slug: string; split: string }[];
    }
  ).entries.filter((e) => e.split === "sealed");
  const house = JSON.parse(readFileSync(HOUSE, "utf-8")) as Record<string, string>;

  /**
   * The damaging case is not a renamed concept, it is a concept renamed ONTO a
   * different drawing the set already ships: `bell-2-off` became `bell-off`,
   * so the drawer was briefed on an icon that exists and is not the one asked
   * for. That must be zero, and a plain count is what makes it stay zero.
   */
  it("never renames a concept onto a different real house icon", () => {
    const collisions = entries
      .map((e) => [e.slug, conceptOf({ text: e.slug }).name] as const)
      .filter(([slug, name]) => name !== slug && Boolean(house[name]));
    assert.deepEqual(
      collisions,
      [],
      `renamed onto real icons: ${collisions.map(([a, b]) => `${a}->${b}`).join(", ")}`,
    );
  });

  it("round-trips all but the concepts whose words are genuinely filler", () => {
    const renamed = entries
      .map((e) => [e.slug, conceptOf({ text: e.slug }).name] as const)
      .filter(([slug, name]) => name !== slug)
      .map(([slug]) => slug);
    // `push-the-button` loses "the" and `vector-logo` loses "logo", both of
    // which INTENT removes on purpose. Anything else is a regression.
    assert.deepEqual(renamed.toSorted(), ["push-the-button", "vector-logo"]);
  });
});

describe("isVague", () => {
  it("asks rather than drawing when nothing survives tokenising", () => {
    assert.equal(isVague("please draw me a nice icon"), true);
    assert.equal(isVague("inbox"), false);
    // A one-character brief now survives, because "x" is a shape in this set.
    assert.equal(slugOf("3d"), "3d");
  });
});

describe("conceptOf finish", () => {
  /**
   * Repro: draw a filled icon, start a new one, answer "Which paint leads?"
   * with outlined, get filled. `applyStudioResponse` writes the drawn version's
   * paint back into the toolbar, and the toolbar rode the questionnaire submit
   * alongside the answers, where the old OR chain let any `filled` win.
   */
  it("lets an answered outlined beat a toolbar left on filled", () => {
    assert.equal(
      conceptOf({ answers: { finish: "outlined" }, finish: "filled", text: "inbox" }).finish,
      "outlined",
    );
  });

  it("lets an answered outlined beat the word solid in the brief", () => {
    assert.equal(
      conceptOf({ answers: { finish: "outlined" }, text: "a solid bell" }).finish,
      "outlined",
    );
  });

  it("still infers from the toolbar and the brief when the paint went unanswered", () => {
    assert.equal(conceptOf({ finish: "filled", text: "inbox" }).finish, "filled");
    assert.equal(conceptOf({ text: "a solid bell" }).finish, "filled");
    assert.equal(conceptOf({ text: "inbox" }).finish, "outlined");
  });

  it("falls through an answer that names neither paint", () => {
    assert.equal(conceptOf({ answers: { finish: "" }, text: "a solid bell" }).finish, "filled");
  });
});

describe("conceptOf tags", () => {
  /**
   * The notes answer is a tag source beside the attachment and annotation text,
   * and those two slice. This one did not, so one long note contributed a tag
   * per word with no ceiling at all.
   */
  it("caps the tags one notes answer can contribute", () => {
    const words = Array.from({ length: 40 }, (_, i) => `note${i}`);
    assert.deepEqual(conceptOf({ answers: { notes: words.join(" ") }, text: "inbox" }).tags, [
      "inbox",
      ...words.slice(0, 12),
    ]);
  });
});

describe("studioRequestSchema answers", () => {
  it("keeps only the ids CLARIFY asks about", () => {
    const parsed = studioRequestSchema.parse({
      answers: { made_up: "anything", object: "bell" },
      text: "bell",
    });
    assert.deepEqual(parsed.answers, { object: "bell" });
  });

  it("bounds an answer on both axes", () => {
    assert.equal(
      studioRequestSchema.safeParse({ answers: { notes: "n".repeat(2001) }, text: "bell" }).success,
      false,
    );
    assert.equal(
      studioRequestSchema.safeParse({
        answers: { notes: Array.from({ length: 13 }, () => "n") },
        text: "bell",
      }).success,
      false,
    );
  });
});
