/** Invocation-only context isolation; never edits user configuration. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const promptSchema = z.array(
  z
    .object({
      content: z
        .array(z.object({ text: z.string().optional() }).passthrough())
        .optional(),
    })
    .passthrough()
);
const promptText = (raw: string) =>
  promptSchema
    .parse(JSON.parse(raw))
    .flatMap((item) => item.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const discoveredSkillPaths = (text: string) => {
  const roots = new Map(
    [...text.matchAll(/- `(?<alias>r\d+)` = `(?<root>[^`]+)`/gu)].map(
      (match) => [match.groups?.alias, match.groups?.root]
    )
  );
  return [
    ...new Set(
      [...text.matchAll(/\(file: (?<file>[^)]+)\)/gu)].map((match) => {
        const file = match.groups?.file ?? "";
        if (path.isAbsolute(file)) {
          return file;
        }
        const [alias, ...parts] = file.split("/");
        const root = roots.get(alias);
        if (!root || !path.isAbsolute(root)) {
          throw new Error("Unresolved native skill catalog path");
        }
        return path.join(root, ...parts);
      })
    ),
  ];
};

export const prepareAuthorContext = (
  command: string,
  out: string,
  env: NodeJS.ProcessEnv,
  invoke?: (args: readonly string[]) => string
) => {
  const base = [
    "--disable",
    "plugins",
    "--disable",
    "memories",
    "--disable",
    "skill_search",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "skills.max_context_tokens=10000",
  ];
  const disabled = new Set<string>();
  const probes: {
    promptSha256: string;
    discoveredSkills: number;
    textCharacters: number;
  }[] = [];
  const run =
    invoke ??
    ((args: readonly string[]) => {
      const result = spawnSync(command, args, {
        cwd: out,
        encoding: "utf-8",
        env,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
      });
      if (result.status !== 0 || result.error) {
        throw new Error(
          `Native context preflight failed: ${result.error ?? result.stderr}`
        );
      }
      return result.stdout;
    });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const config = `skills.config=[${[...disabled].map((file) => `{path=${JSON.stringify(file)},enabled=false}`).join(",")}]`;
    const args = [...base, "-c", config];
    const raw = run([
      "debug",
      "prompt-input",
      ...args,
      "--",
      "Inspect only the supplied drawing packet.",
    ]);
    const text = promptText(raw);
    const paths = discoveredSkillPaths(text);
    probes.push({
      discoveredSkills: paths.length,
      promptSha256: digest(raw),
      textCharacters: text.length,
    });
    if (
      !text.includes("<skills_instructions>") &&
      !text.includes("<recommended_plugins>")
    ) {
      const receiptName = "context-preflight.json";
      writeFileSync(
        path.join(out, receiptName),
        JSON.stringify(
          {
            argsSha256: digest(JSON.stringify(args)),
            disabledSkills: disabled.size,
            globalConfigurationEdited: false,
            probes,
            scope:
              "Offline context serialization; actual native trace remains authoritative",
          },
          null,
          2
        )
      );
      return { args, receiptName };
    }
    const newPaths = paths.filter((file) => !disabled.has(file));
    if (!newPaths.length) {
      throw new Error(
        "Native context still contains ambient capabilities after disabling discovered skills"
      );
    }
    for (const file of newPaths) {
      disabled.add(file);
    }
  }
  throw new Error(
    "Native skill context did not converge within four preflight probes"
  );
};

/** Verify the actual session too; an offline preview is not final evidence. */
export const assertNoAmbientCatalogs = (trace: string) => {
  for (const line of trace.split("\n").filter(Boolean)) {
    const record = JSON.parse(line);
    const item = record.payload;
    if (
      record.type !== "response_item" ||
      item?.type !== "message" ||
      !["user", "developer", "system"].includes(item.role)
    ) {
      continue;
    }
    const text = (item.content ?? [])
      .map((block: { text?: string }) => block.text ?? "")
      .join("\n");
    if (
      text.includes("<skills_instructions>") ||
      text.includes("<recommended_plugins>")
    ) {
      throw new Error(
        "Native author received an unrelated skill or plugin catalog"
      );
    }
  }
};
