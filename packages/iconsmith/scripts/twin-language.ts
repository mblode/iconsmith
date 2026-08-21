/**
 * One-shot: render house twins, ask vision (and an image model in text
 * mode) to name the outlined→filled transform in icon language.
 *
 *   npx tsx scripts/twin-language.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateObject, generateText } from "ai";
import { z } from "zod";

import {
  FILLED_VARIANT,
  HOUSE_VARIANT,
  loadCorpus,
} from "../src/corpus/load.js";
import { resolveModel } from "../src/pipeline/gateway.js";
import { png, sheet } from "../src/tools/render.js";

const OUT = ".staging/twin-language";
const VISION = "google/gemini-3.5-flash";
const NANO = "google/gemini-2.5-flash-image";
const GPT = "openai/gpt-image-1-mini";

const WANT = [
  "plus",
  "circle-plus",
  "square-plus",
  "battery",
  "battery-empty",
  "battery-full",
  "folder",
  "folder-open",
  "flag",
  "heart",
  "circle",
  "donut",
  "cookies",
  "ban",
  "airplane",
  "archive",
  "add-image",
  "hamburger-menu",
];

const schema = z.object({
  construction: z.string(),
  families: z.array(
    z.object({
      family: z.string(),
      filled: z.string(),
      outlined: z.string(),
      transform: z.string(),
    })
  ),
  not: z.array(z.string()),
  rules: z.array(
    z.object({
      name: z.string(),
      rule: z.string(),
    })
  ),
});

const ask = [
  "Each pair is the same house icon twice: outlined on the left, filled on the right.",
  "Describe how filled is usually made from outlined, and the reverse.",
  "Speak in icon language: rect, circle, line, dot, hole, silhouette, knockout, badge.",
  "Never quote path data or coordinates. Name the families you can see.",
  "Rules only — what stays the same (extent, metaphor, marks) and what changes (paint, interiors, open strokes).",
].join(" ");

const main = async (): Promise<void> => {
  const corpus = await loadCorpus();
  mkdirSync(OUT, { recursive: true });
  const present = WANT.filter(
    (name) =>
      corpus.has(name, HOUSE_VARIANT) && corpus.has(name, FILLED_VARIANT)
  );
  const pairs = await Promise.all(
    present.map(async (name) => {
      const [outlinedSvg, filledSvg] = await Promise.all([
        corpus.svg(name, HOUSE_VARIANT),
        corpus.svg(name, FILLED_VARIANT),
      ]);
      const [outlined, filled] = await Promise.all([
        png(outlinedSvg, 192),
        png(filledSvg, 192),
      ]);
      writeFileSync(path.join(OUT, `${name}.outlined.png`), outlined);
      writeFileSync(path.join(OUT, `${name}.filled.png`), filled);
      return { filled, name, outlined };
    })
  );
  const svgs = await Promise.all(
    pairs.flatMap((p) => [
      corpus.svg(p.name, HOUSE_VARIANT),
      corpus.svg(p.name, FILLED_VARIANT),
    ])
  );
  const contact = await sheet(svgs, { cols: 2, size: 128 });
  writeFileSync(path.join(OUT, "contact.png"), contact);

  const files = pairs.flatMap((p) => [
    {
      data: p.outlined,
      mediaType: "image/png" as const,
      type: "file" as const,
    },
    { data: p.filled, mediaType: "image/png" as const, type: "file" as const },
  ]);

  const { object } = await generateObject({
    messages: [
      {
        content: [
          {
            text: `Pairs in order: ${pairs.map((p) => p.name).join(", ")}. ${ask}`,
            type: "text",
          },
          ...files,
        ],
        role: "user",
      },
    ],
    model: resolveModel(VISION),
    schema,
  });
  writeFileSync(
    path.join(OUT, "vision.json"),
    `${JSON.stringify(object, null, 2)}\n`
  );

  const language = async (model: string): Promise<string> => {
    const result = await generateText({
      messages: [
        {
          content: [
            { text: `${ask} Reply in prose, no image.`, type: "text" },
            { data: contact, mediaType: "image/png", type: "file" },
          ],
          role: "user",
        },
      ],
      model: resolveModel(model),
    });
    return result.text;
  };

  const nano = await language(NANO).catch(
    (error: Error) => `nano failed: ${error.message}`
  );
  const gpt = await language(GPT).catch(
    (error: Error) => `gpt-image failed: ${error.message}`
  );
  writeFileSync(
    path.join(OUT, "image-models.json"),
    `${JSON.stringify({ gpt, nano, pairs: pairs.map((p) => p.name) }, null, 2)}\n`
  );
  process.stdout.write(
    `${JSON.stringify({ families: object.families.length, pairs: pairs.map((p) => p.name) })}\n`
  );
};

await main();
