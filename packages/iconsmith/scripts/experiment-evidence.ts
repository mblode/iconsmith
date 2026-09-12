/** Strict evidence parsing shared by SVG experiments; no provider dispatch. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

const issue = z.object({
  message: z.string(),
  rule: z.string(),
  severity: z.enum(["error", "warn"]),
});
const reportSchema = z.object({
  errors: z.number().int().nonnegative(),
  files: z.array(z.object({ file: z.string(), issues: z.array(issue) })).min(1),
  warnings: z.number().int().nonnegative(),
});

export const parseLintResult = (status: number | null, stdout: string) => {
  if (status !== 0 && status !== 1) {
    throw new Error(
      `Checker failed with status ${status}; findings are unavailable.`
    );
  }
  const report = reportSchema.parse(JSON.parse(stdout));
  const findings = report.files.flatMap((file) => file.issues);
  const errors = findings.filter(
    (finding) => finding.severity === "error"
  ).length;
  const warnings = findings.filter(
    (finding) => finding.severity === "warn"
  ).length;
  if (
    errors !== report.errors ||
    warnings !== report.warnings ||
    status !== (errors ? 1 : 0)
  ) {
    throw new Error("Checker status and findings disagree.");
  }
  return report;
};

const checkSvgFiles = (cli: string, files: string[]) => {
  if (!files.length) {
    throw new Error("At least one SVG is required.");
  }
  const result = spawnSync(
    process.execPath,
    [cli, "--output", "json", "lint", ...files],
    {
      encoding: "utf-8",
      timeout: 30_000,
    }
  );
  if (result.error) {
    throw result.error;
  }
  const report = parseLintResult(result.status, result.stdout);
  if (
    report.files.length !== files.length ||
    report.files.some((row, index) => row.file !== files[index])
  ) {
    throw new Error("Checker did not return exactly the requested files.");
  }
  return report;
};

const reviewSchema = z.object({
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  craftScore: z.number().int().min(0).max(10),
  criticalDefects: z.array(z.string()),
  freeRecognition: z.string().min(1),
  reviewer: z.string().min(1),
  semanticMatch: z.boolean(),
  shipUnchanged: z.boolean(),
  uncertain: z.boolean(),
});

export const assessReviews = (
  artifact: string,
  expectedReviewers: string[],
  input: unknown
) => {
  if (expectedReviewers.length !== 2 || new Set(expectedReviewers).size !== 2) {
    throw new Error(
      "Two distinct independent reviewer identities are required."
    );
  }
  const hash = createHash("sha256").update(artifact).digest("hex");
  const parsed = z.array(reviewSchema.nullable()).safeParse(input);
  if (!parsed.success) {
    return {
      reason: "Malformed or missing review evidence",
      status: "incomplete",
      usable: false,
    };
  }
  const reviews = parsed.data.filter((review) => review !== null);
  if (
    reviews.length !== 2 ||
    parsed.data.length !== 2 ||
    new Set(reviews.map((review) => review.reviewer)).size !== 2 ||
    reviews.some(
      (review) =>
        !expectedReviewers.includes(review.reviewer) ||
        review.artifactSha256 !== hash
    )
  ) {
    return {
      reason: "Missing, duplicate, unexpected or stale reviewer evidence",
      status: "incomplete",
      usable: false,
    };
  }
  const usable = reviews.every(
    (review) =>
      review.semanticMatch &&
      review.craftScore >= 9 &&
      review.shipUnchanged &&
      review.criticalDefects.length === 0 &&
      !review.uncertain
  );
  return {
    reason: usable
      ? "Both reviewers pass the frozen rubric"
      : "At least one complete review rejects the artifact",
    status: usable ? "accepted" : "rejected",
    usable,
  };
};

if (process.argv[1]?.endsWith("experiment-evidence.ts")) {
  const [cli, ...files] = process.argv.slice(2);
  if (!cli) {
    throw new Error("Usage: experiment-evidence.ts <built-cli.js> <svg...>");
  }
  const report = checkSvgFiles(cli, files);
  console.log(
    JSON.stringify({
      ...report,
      artifacts: files.map((file) => ({
        file,
        sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      })),
    })
  );
  process.exitCode = report.errors ? 1 : 0;
}
