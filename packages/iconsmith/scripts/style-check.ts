/** Exact local replay and preview for a pair in one pinned reference style. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { opticalProof } from "../src/tools/proof.js";
import { png, sheet } from "../src/tools/render.js";

export const checkStyle = async (
  revisionPath: string,
  master: string,
  directory: string,
  selectedFinish?: "outlined" | "filled"
): Promise<void> => {
  const snapshot = mkdtempSync(path.join(directory, "check-"));
  const save = (name: string, data: string | Uint8Array) => {
    writeFileSync(path.join(snapshot, name), data);
    writeFileSync(path.join(directory, name), data);
  };
  try {
    // Historical snapshots survive. Latest files may only describe this check,
    // including when a paired run becomes single-paint or compilation fails.
    for (const name of [
      ...["outlined", "filled"].flatMap((paint) =>
        [
          "svg",
          "png",
          "artifact.json",
          "proof.png",
          "proof.json",
          "native.png",
          "retina.png",
          "pixels.json",
        ].map((extension) => `${paint}.${extension}`)
      ),
      "native.png",
      "preview-16.png",
    ]) {
      rmSync(path.join(directory, name), { force: true });
    }
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
      return lint(drawing.canvas, { keyline: drawing.keyline }).map(
        (issue) => ({
          ...issue,
          finish: artifact.finish,
        })
      );
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
        const evidence = await opticalProof(artifact.svg, style.spec.size);
        save(`${stem}.proof.png`, evidence.proof);
        save(`${stem}.native.png`, evidence.native);
        save(`${stem}.retina.png`, evidence.retina);
        save(`${stem}.pixels.json`, JSON.stringify(evidence.pixels, null, 2));
        save(`${stem}.proof.json`, JSON.stringify(evidence.metadata, null, 2));
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
    const issues = [...findings, ...pairIssues];
    let structuralStatus = issues.length ? "findings-require-review" : "passed";
    if (issues.some((issue) => issue.severity === "error")) {
      structuralStatus = "failed";
    }
    const report = {
      assessment: "structural-only",
      craftApproved: false,
      exactReplay: true,
      findings,
      nativeSize: style.spec.size,
      paints: finishes,
      pairChecked: finishes.length === 2,
      pairIssues,
      preview16: style.spec.size === 16 ? "native" : "downsample",
      snapshot,
      structuralStatus,
      style: style.key,
      visualReview: "required",
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
      assessment: "structural-only",
      craftApproved: false,
      error: String(error),
      exactReplay: false,
      snapshot,
      structuralStatus: "failed",
      visualReview: "required",
    };
    save("checks.json", JSON.stringify(failure, null, 2));
    writeFileSync(
      path.join(snapshot, "failure.json"),
      JSON.stringify(failure, null, 2)
    );
    throw error;
  }
};

if (process.argv[1]?.endsWith("style-check.ts")) {
  const [revisionPath, master, directory, finish] = process.argv.slice(2);
  if (
    !revisionPath ||
    !master ||
    !directory ||
    (finish !== undefined && finish !== "outlined" && finish !== "filled")
  ) {
    throw new Error(
      "Usage: style-check.ts <revision.json> <master> <directory> [outlined|filled]"
    );
  }
  await checkStyle(revisionPath, master, directory, finish);
}
