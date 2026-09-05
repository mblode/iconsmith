/** Selected-style local run: prepare, author, recheck, require delivery. */
import { execFile, spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createStyleRevision, selectStyle } from "../src/pipeline/style.js";
import { sheet } from "../src/tools/render.js";

interface ProcessResult {
  code: number | string | null;
  killed: boolean;
  stdout: string;
  stderr: string;
}
interface LocalStyleOptions {
  out: string;
  revisionPath: string;
  master: string;
  finish?: "outlined" | "filled";
  concept: string;
  guidance?: string;
  command: string;
  args: (brief: string) => string[];
  env: NodeJS.ProcessEnv;
  /** Test seam for the external author. Compilation always runs for real. */
  invoke?: (brief: string) => Promise<ProcessResult>;
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const runLocalStyle = async (options: LocalStyleOptions) => {
  const { out } = options;
  const revision = createStyleRevision(
    JSON.parse(readFileSync(options.revisionPath, "utf-8"))
  );
  const style = selectStyle(revision, options.master);
  const paints = options.finish ? [options.finish] : ["outlined", "filled"];
  const save = (name: string, data: string | Uint8Array) =>
    writeFileSync(path.join(out, name), data);
  save("revision.json", JSON.stringify(revision.definition, null, 2));
  save("spec.json", JSON.stringify(style.spec, null, 2));
  save(
    "parts-names.json",
    JSON.stringify(
      style.parts.map(({ id, name, w, h }) => ({ h, id, name, w })),
      null,
      2
    )
  );
  save(
    "reference-order.json",
    JSON.stringify(
      style.references.map((r) => r.name),
      null,
      2
    )
  );
  if (style.references.length) {
    save(
      "references.png",
      await sheet(
        style.references.map((r) => r.svg),
        { cols: 4, size: 96 }
      )
    );
  }
  copyFileSync(
    fileURLToPath(new URL("../SKILL.md", import.meta.url)),
    path.join(out, "SKILL.md")
  );
  const checker = [
    "--import",
    import.meta.resolve("tsx"),
    fileURLToPath(new URL("style-check.ts", import.meta.url)),
    path.join(out, "revision.json"),
    options.master,
    out,
    ...(options.finish ? [options.finish] : []),
  ];
  const brief = `Design ${options.concept} in the pinned reference style. Read SKILL.md, spec.json and parts-names.json. Selected spec values override generic house defaults. ${style.references.length ? "Inspect references.png; reference-order.json lists its row-major order." : "No reference images supplied; do not claim reference matching."}
Write ${paints.map((p) => `${p}.icon`).join(" and ")} and review.md in this directory. Do not modify compiler, specs or reference files. Use only constrained DSL primitives and admitted parts; no raw path data. No network, API tools, other agents or installs.
${options.guidance ?? ""}
Run the real checker after each revision:
${[process.execPath, ...checker].map(quote).join(" ")}
Inspect the actual enlarged PNGs and native.png at ${style.spec.size}px. Review gaps, counter survival, curves, modifier readability and family proportions. Inspect resolved SVG contours when feature warnings identify tiny regions: invisibility at native size does not prove a contour is redundant. Account for intended holes and solid regions; repair unexpected holes or report them as unresolved. Never dismiss a contour as Boolean bookkeeping without geometric evidence. Preserve attempt-N programs before changes; checker snapshots retain compile evidence. Fix errors and explain unresolved warnings. A clean check is not a craft verdict. Up to four revisions, eight minutes. Required review.md must name inspected files, changes and unresolved visual defects. Missing review means incomplete delivery, regardless of process exit code. Only write here. Read BRIEF.md and execute.`;
  save("BRIEF.md", brief);
  const intent = {
    billing: "subscription",
    craftApproved: false,
    master: options.master,
    nativeSize: style.spec.size,
    paints,
    style: style.key,
  };
  save(
    "delivery.json",
    JSON.stringify({ ...intent, status: "running" }, null, 2)
  );
  const invoke =
    options.invoke ??
    (async (prompt: string): Promise<ProcessResult> => {
      try {
        const running = promisify(execFile)(
          options.command,
          options.args(prompt),
          {
            cwd: out,
            env: options.env,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 480_000,
          }
        );
        running.child.stdin?.end();
        const { stdout, stderr } = await running;
        return { code: 0, killed: false, stderr, stdout };
      } catch (error) {
        const failure = error as Error & {
          code?: number | string;
          killed?: boolean;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: failure.code ?? null,
          killed: failure.killed ?? false,
          stderr: failure.stderr ?? String(error),
          stdout: failure.stdout ?? "",
        };
      }
    });
  const inputNames = [
    "revision.json",
    "spec.json",
    "parts-names.json",
    "reference-order.json",
    "SKILL.md",
    "BRIEF.md",
    ...(style.references.length ? ["references.png"] : []),
  ];
  const inputs = new Map(
    inputNames.map((name) => [name, readFileSync(path.join(out, name))])
  );
  let author: ProcessResult;
  try {
    author = await invoke(brief);
  } catch (error) {
    author = { code: null, killed: false, stderr: String(error), stdout: "" };
  }
  save("author.json", JSON.stringify(author, null, 2));
  const changedInputs = inputNames.filter((name) => {
    try {
      return !inputs.get(name)?.equals(readFileSync(path.join(out, name)));
    } catch {
      return true;
    }
  });
  const checked = changedInputs.length
    ? {
        status: null,
        stderr: "Pinned input changed; final check refused.",
        stdout: "",
      }
    : spawnSync(process.execPath, checker, {
        cwd: out,
        encoding: "utf-8",
        env: options.env,
      });
  save("check-output.txt", `${checked.stdout ?? ""}\n${checked.stderr ?? ""}`);
  const missing = [...paints.map((p) => `${p}.icon`), "review.md"].filter(
    (name) => {
      try {
        return !readFileSync(path.join(out, name), "utf-8").trim();
      } catch {
        return true;
      }
    }
  );
  const complete =
    author.code === 0 &&
    !author.killed &&
    checked.status === 0 &&
    missing.length === 0;
  const result = {
    ...intent,
    authorExitCode: author.code,
    changedInputs,
    checkExitCode: checked.status,
    missing,
    reviewContentValidated: false,
    status: complete ? "delivered" : "incomplete",
  };
  save("delivery.json", JSON.stringify(result, null, 2));
  return result;
};
