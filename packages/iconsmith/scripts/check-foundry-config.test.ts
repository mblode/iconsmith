import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { checkFoundryConfig } from "./check-foundry-config.js";

it("passes current configuration and rejects each dangerous mutation independently", () => {
  const source = path.resolve(import.meta.dirname, "../../..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundry-config-"));
  const files = [
    "package.json",
    "turbo.json",
    ".gitignore",
    ...["packages/iconsmith"].map((dir) => `${dir}/package.json`),
  ];
  try {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(path.join(source, file), path.join(root, file));
    }
    expect(checkFoundryConfig(root)).toEqual([]);
    const mutations = [
      [".gitignore", () => "corpus/\n", "F11"],
      ["turbo.json", () => '{"tasks":{"test":{"cache":true}}}', "F12"],
      [
        "packages/iconsmith/package.json",
        (raw: string) => {
          const value = JSON.parse(raw);
          value.scripts.test += " --passWithNoTests";
          return JSON.stringify(value);
        },
        "F51",
      ],
      [
        "package.json",
        (raw: string) => {
          const value = JSON.parse(raw);
          value.devDependencies.oxlint = "1.79.0";
          return JSON.stringify(value);
        },
        "F14",
      ],
      [
        "packages/iconsmith/package.json",
        (raw: string) => {
          const value = JSON.parse(raw);
          value.devDependencies = {
            ...value.devDependencies,
            oxlint: "1.78.0",
          };
          return JSON.stringify(value);
        },
        "F14",
      ],
      [
        "packages/iconsmith/package.json",
        (raw: string) => {
          const value = JSON.parse(raw);
          value.bin = "dist/cli.js";
          return JSON.stringify(value);
        },
        "F22",
      ],
    ] as const;
    for (const [file, mutate, id] of mutations) {
      const target = path.join(root, file);
      const original = fs.readFileSync(target, "utf-8");
      fs.writeFileSync(target, mutate(original));
      expect(
        checkFoundryConfig(root).some((failure) => failure.startsWith(id))
      ).toBe(true);
      fs.writeFileSync(target, original);
      expect(checkFoundryConfig(root)).toEqual([]);
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
