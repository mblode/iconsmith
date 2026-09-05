/** Exact local replay and preview for a pair in one pinned reference style. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { pairPrograms } from "../src/pipeline/pair.js";
import {
  compileStyle,
  createStyleRevision,
  replayStyle,
  selectStyle,
} from "../src/pipeline/style.js";
import { run } from "../src/tools/dsl.js";
import { lint } from "../src/tools/lint.js";
import { png, sheet } from "../src/tools/render.js";

const [revisionPath, master, directory, selectedFinish] = process.argv.slice(2);
if (
  !revisionPath ||
  !master ||
  !directory ||
  (selectedFinish !== undefined &&
    selectedFinish !== "outlined" &&
    selectedFinish !== "filled")
) {
  throw new Error(
    "Usage: style-check.ts <revision.json> <master> <directory> [outlined|filled]"
  );
}
const snapshot = mkdtempSync(path.join(directory, "check-"));
const save = (name: string, data: string | Uint8Array) => {
  writeFileSync(path.join(snapshot, name), data);
  writeFileSync(path.join(directory, name), data);
};
try {
  const style = selectStyle(
    createStyleRevision(JSON.parse(readFileSync(revisionPath, "utf-8"))),
    master
  );
  const finishes = selectedFinish ? [selectedFinish] : ["outlined", "filled"];
  const programs = finishes.map((finish) =>
    readFileSync(path.join(directory, `${finish}.icon`), "utf-8")
  );
  for (const [index, program] of programs.entries()) {
    writeFileSync(path.join(snapshot, `${finishes[index]}.icon`), program);
  }
  const artifacts = programs.map((program) => compileStyle(style, program));
  const findings = artifacts.flatMap((artifact, index) => {
    if (artifact.finish !== finishes[index]) {
      throw new Error(`Wrong paint in ${finishes[index]}.icon`);
    }
    replayStyle(style, artifact);
    const drawing = run(artifact.program, [...style.parts], {
      spec: style.spec,
    });
    return lint(drawing.canvas, { keyline: drawing.keyline }).map((issue) => ({
      ...issue,
      finish: artifact.finish,
    }));
  });
  const pairIssues =
    finishes.length === 2
      ? pairPrograms(
          [],
          "outlined",
          programs[0],
          programs[1],
          [...style.parts],
          style.spec
        )
      : [];
  await Promise.all(
    artifacts.map(async (artifact) => {
      const stem = artifact.finish;
      save(`${stem}.artifact.json`, JSON.stringify(artifact, null, 2));
      save(`${stem}.svg`, artifact.svg);
      save(`${stem}.png`, await png(artifact.svg, 192));
    })
  );
  save(
    "native.png",
    await sheet(
      artifacts.map((artifact) => artifact.svg),
      { cols: finishes.length, size: style.spec.size }
    )
  );
  save(
    "preview-16.png",
    await sheet(
      artifacts.map((artifact) => artifact.svg),
      { cols: finishes.length, size: 16 }
    )
  );
  const report = {
    craftApproved: false,
    exactReplay: true,
    findings,
    nativeSize: style.spec.size,
    paints: finishes,
    pairChecked: finishes.length === 2,
    pairIssues,
    preview16: style.spec.size === 16 ? "native" : "downsample",
    snapshot,
    style: style.key,
  };
  save("checks.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (
    [...findings, ...pairIssues].some((issue) => issue.severity === "error")
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  const failure = {
    craftApproved: false,
    error: String(error),
    exactReplay: false,
    snapshot,
  };
  save("checks.json", JSON.stringify(failure, null, 2));
  writeFileSync(
    path.join(snapshot, "failure.json"),
    JSON.stringify(failure, null, 2)
  );
  throw error;
}
