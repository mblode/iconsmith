/** Read-only development assessment over sealed AI review campaign receipts. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DRAFT_ACCEPTANCE_CONTRACT } from "../src/eval/acceptance-contract.js";
import { readAiReviewTerminal } from "./ai-review-campaign.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf-8"));
const choice = (answers: Record<string, { choice?: unknown }>, id: string) => {
  const value = answers[id]?.choice;
  return typeof value === "string" ? value : null;
};
const median = (values: readonly number[]) => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
const equalHashes = (left: unknown, right: Record<string, string>) =>
  typeof left === "object" &&
  left !== null &&
  JSON.stringify(
    Object.entries(left).toSorted(([a], [b]) => a.localeCompare(b))
  ) ===
    JSON.stringify(
      Object.entries(right).toSorted(([a], [b]) => a.localeCompare(b))
    );

interface FrozenStimulus {
  conceptSha256: string;
  familyReferences: readonly { sha256: string }[];
  id: string;
  image: { sha256: string };
  meanings: readonly string[];
}
interface FrozenRoute {
  id: string;
  model: string;
}

// eslint-disable-next-line complexity -- receipt validation fails closed across all bound fields
const readReview = (
  campaign: string,
  intentHash: string,
  route: FrozenRoute,
  stimulus: FrozenStimulus,
  packet: readonly FrozenStimulus[],
  originalDeadlineAt?: number
) => {
  const directory = path.join(campaign, route.id);
  if (!existsSync(directory)) {
    return { complete: false as const, reason: "missing", route: route.id };
  }
  try {
    const { result, terminal } = readAiReviewTerminal({
      campaignIntentHash: intentHash,
      directory,
      model: route.model,
      originalDeadlineAt,
      routeId: route.id,
    });
    if (terminal.status !== "complete" || result?.status !== "complete") {
      return {
        complete: false as const,
        reason: terminal.status,
        route: route.id,
      };
    }
    const recognition = readJson(path.join(directory, "recognition.json"));
    const craft = readJson(path.join(directory, "craft.json"));
    const recognitionAnswers = recognition.answers ?? {};
    const craftAnswers = craft.answers ?? {};
    const recognitionChoice = choice(
      recognitionAnswers,
      `${stimulus.id}-recognition`
    );
    const craftChoice = choice(craftAnswers, `${stimulus.id}-craft`);
    const identity = {
      model: recognition.model,
      provider: recognition.provider,
    };
    const recognitionHashes = Object.fromEntries(
      packet.map((row) => [`${row.id}.png`, row.image.sha256])
    );
    const craftHashes = {
      ...recognitionHashes,
      ...Object.fromEntries(
        packet.flatMap((row) =>
          row.familyReferences.map(({ sha256 }) => [
            `family-${sha256}.png`,
            sha256,
          ])
        )
      ),
    };
    const recognitionRows = packet.map((row) => {
      const selected = choice(recognitionAnswers, `${row.id}-recognition`);
      return {
        correct:
          selected === "uncertain"
            ? null
            : sha(selected ?? "") === row.conceptSha256,
        id: row.id,
      };
    });
    if (
      recognition.status !== "complete" ||
      craft.status !== "complete" ||
      identity.model !== route.model ||
      craft.model !== identity.model ||
      !equalHashes(recognition.evidenceHashes, recognitionHashes) ||
      !equalHashes(craft.evidenceHashes, craftHashes) ||
      result.recognitionHash !== sha(JSON.stringify(recognition)) ||
      JSON.stringify(result.craft) !== JSON.stringify(craft) ||
      JSON.stringify(result.recognition) !== JSON.stringify(recognitionRows) ||
      recognitionChoice === null ||
      ![...stimulus.meanings, "uncertain"].includes(recognitionChoice) ||
      !/^(?:10|[1-9])$/u.test(craftChoice ?? "")
    ) {
      throw new Error("review identity, evidence or answers are incomplete");
    }
    const judgment = {
      craft: Number(craftChoice),
      critical: choice(craftAnswers, `${stimulus.id}-critical`),
      family: choice(craftAnswers, `${stimulus.id}-family`),
      native: choice(craftAnswers, `${stimulus.id}-native`),
      recognition: recognitionChoice,
      ship: choice(craftAnswers, `${stimulus.id}-ship`),
    };
    if (
      ![
        judgment.critical,
        judgment.family,
        judgment.native,
        judgment.ship,
      ].every(
        (value) => value !== null && ["yes", "no", "uncertain"].includes(value)
      )
    ) {
      throw new Error("review rubric answers are incomplete");
    }
    if (
      typeof identity.provider !== "string" ||
      !identity.provider.trim() ||
      craft.provider !== identity.provider
    ) {
      return {
        complete: false as const,
        diagnosticJudgment: judgment,
        model: identity.model,
        provider: null,
        reason: "review provider identity is missing or inconsistent",
        route: route.id,
      };
    }
    return {
      complete: true as const,
      identity,
      judgment,
      route: route.id,
    };
  } catch (error) {
    return {
      complete: false as const,
      reason: String(error),
      route: route.id,
    };
  }
};

export interface AiCalibrationAssessmentOptions {
  conditionKeyFile: string;
  expectedConditionKeySha256: string;
}
interface CalibrationCondition {
  id: string;
  canonicalArtifactId: string;
  concept: string;
  sheetSha256: string;
  presentation: "original" | "identical-repeat" | "reference-order-reversed";
}
const validateCalibrationConditions = (
  conditions: readonly CalibrationCondition[],
  packet: readonly FrozenStimulus[]
) => {
  for (const row of conditions) {
    const stimulus = packet.find((item) => item.id === row.id);
    const canonical = conditions.find(
      (item) => item.id === row.canonicalArtifactId
    );
    if (
      !stimulus ||
      typeof row.concept !== "string" ||
      sha(row.concept) !== stimulus.conceptSha256 ||
      row.sheetSha256 !== stimulus.image.sha256 ||
      !canonical ||
      canonical.canonicalArtifactId !== canonical.id ||
      canonical.presentation !== "original" ||
      canonical.sheetSha256 !== row.sheetSha256 ||
      canonical.concept !== row.concept ||
      !["original", "identical-repeat", "reference-order-reversed"].includes(
        row.presentation
      ) ||
      (row.presentation === "original") !== (row.id === row.canonicalArtifactId)
    ) {
      throw new Error(
        "Calibration artifact, semantics or repeat lineage mismatch"
      );
    }
  }
  for (const row of conditions.filter(
    (item) => item.presentation !== "original"
  )) {
    const original = packet.find((item) => item.id === row.canonicalArtifactId);
    const repeated = packet.find((item) => item.id === row.id);
    const refs = original?.familyReferences.map((item) => item.sha256) ?? [];
    const expected =
      row.presentation === "reference-order-reversed"
        ? refs.toReversed()
        : refs;
    if (
      JSON.stringify(expected) !==
      JSON.stringify(repeated?.familyReferences.map((item) => item.sha256))
    ) {
      throw new Error("Calibration ordered reference multiplicity mismatch");
    }
  }
  const canonicalRows = conditions.filter(
    (row) => row.presentation === "original"
  );
  if (
    new Set(canonicalRows.map((row) => row.sheetSha256)).size !==
    canonicalRows.length
  ) {
    throw new Error(
      "Repeated bytes cannot supply independent calibration artifacts"
    );
  }
  return canonicalRows;
};
const assessCalibration = (
  options: AiCalibrationAssessmentOptions,
  packet: readonly FrozenStimulus[],
  routes: readonly FrozenRoute[],
  outcomes: readonly { id: string; reviews: ReturnType<typeof readReview>[] }[]
) => {
  const bytes = readFileSync(options.conditionKeyFile, "utf-8");
  if (
    !/^[a-f0-9]{64}$/u.test(options.expectedConditionKeySha256) ||
    sha(bytes) !== options.expectedConditionKeySha256
  ) {
    throw new Error("Calibration condition key identity drift");
  }
  const key = JSON.parse(bytes) as { rows: CalibrationCondition[] };
  if (
    !Array.isArray(key.rows) ||
    key.rows.length !== packet.length ||
    new Set(key.rows.map((row) => row.id)).size !== packet.length
  ) {
    throw new Error("Calibration condition population mismatch");
  }
  const canonicalRows = validateCalibrationConditions(key.rows, packet);
  const thresholds = DRAFT_ACCEPTANCE_CONTRACT.calibration;
  const reviewers = routes.map((route) => {
    const rows = key.rows.map((condition) => {
      const review = outcomes
        .find((row) => row.id === condition.id)
        ?.reviews.find((item) => item.route === route.id);
      const judgment = review?.complete ? review.judgment : null;
      return {
        absoluteAnchorPass:
          judgment !== null &&
          judgment.craft >= thresholds.absoluteCraftAnchorMinimum &&
          judgment.critical === "no" &&
          judgment.ship === "yes" &&
          judgment.family === "yes" &&
          judgment.native === "yes" &&
          judgment.recognition === condition.concept,
        complete: review?.complete === true,
        condition,
        judgment,
      };
    });
    const repeats = rows
      .filter((row) => row.condition.presentation !== "original")
      .map((row) => {
        const original = rows.find(
          (item) => item.condition.id === row.condition.canonicalArtifactId
        );
        const left = original?.judgment;
        const right = row.judgment;
        const craftDelta =
          left && right ? Math.abs(left.craft - right.craft) : null;
        const categoriesStable = Boolean(
          left &&
          right &&
          (
            ["critical", "ship", "recognition", "family", "native"] as const
          ).every((field) => left[field] === right[field])
        );
        return {
          categoriesStable,
          craftDelta,
          originalId: row.condition.canonicalArtifactId,
          passed:
            craftDelta !== null &&
            craftDelta <= thresholds.maximumRepeatCraftDelta &&
            categoriesStable,
          repeatId: row.condition.id,
        };
      });
    return {
      absoluteAnchorPass: rows.every((row) => row.absoluteAnchorPass),
      matchedControlsPass:
        repeats.length > 0 && repeats.every((row) => row.passed),
      model: route.model,
      repeats,
      routeId: route.id,
      rows,
    };
  });
  return {
    canonicalArtifacts: canonicalRows.length,
    conditionKeySha256: options.expectedConditionKeySha256,
    passed: reviewers.every(
      (row) => row.absoluteAnchorPass && row.matchedControlsPass
    ),
    presentationRepeats: key.rows.length - canonicalRows.length,
    qualified: false,
    reviewers,
    scope: "development-house-calibration" as const,
    scoreOffset: null,
    semanticFamilies: new Set(canonicalRows.map((row) => row.concept)).size,
    thresholds,
  };
};

export const assessAiReviewCampaign = (
  campaign: string,
  calibration?: AiCalibrationAssessmentOptions
) => {
  const resolved = path.resolve(campaign);
  const intentFile = path.join(resolved, "intent.json");
  const intent = readJson(intentFile) as {
    packet?: FrozenStimulus[];
    routes?: FrozenRoute[];
    originalDeadlineAt?: number;
  };
  const intentHash = sha(JSON.stringify(intent));
  if (!intent.packet?.length || !intent.routes?.length) {
    throw new Error("AI review campaign has no frozen packet or routes");
  }
  const outcomes = intent.packet.map((stimulus) => {
    const reviews =
      intent.routes?.map((route) =>
        readReview(
          resolved,
          intentHash,
          route,
          stimulus,
          intent.packet ?? [],
          intent.originalDeadlineAt
        )
      ) ?? [];
    const complete = reviews.filter((review) => review.complete);
    const judgments = complete.map((review) => review.judgment);
    const identities = new Set(
      complete.map(
        ({ identity }) => `${identity.provider.trim()}/${identity.model.trim()}`
      )
    );
    const dimensions = [
      "critical",
      "family",
      "native",
      "recognition",
      "ship",
    ] as const;
    const conflicts = dimensions.filter(
      (dimension) =>
        new Set(judgments.map((judgment) => judgment[dimension])).size > 1
    );
    const uncertain = judgments.some(
      (judgment) =>
        judgment.recognition === "uncertain" ||
        [
          judgment.critical,
          judgment.family,
          judgment.native,
          judgment.ship,
        ].includes("uncertain")
    );
    let status:
      | "accepted"
      | "incomplete"
      | "quarantined"
      | "rejected"
      | "uncertain";
    if (judgments.some(({ critical }) => critical === "yes")) {
      status = "quarantined";
    } else if (
      complete.length !== intent.routes?.length ||
      identities.size < 2
    ) {
      status = "incomplete";
    } else if (uncertain || conflicts.length) {
      status = "uncertain";
    } else if (
      judgments.every(
        (judgment) =>
          judgment.family === "yes" &&
          judgment.native === "yes" &&
          sha(judgment.recognition) === stimulus.conceptSha256 &&
          judgment.ship === "yes"
      ) &&
      median(judgments.map(({ craft }) => craft)) >= 9
    ) {
      status = "accepted";
    } else {
      status = "rejected";
    }
    return {
      completeReviewers: complete.length,
      conflicts,
      id: stimulus.id,
      imageSha256: stimulus.image.sha256,
      incompleteReviewers: reviews.length - complete.length,
      reviews,
      status,
    };
  });
  return {
    ...(calibration
      ? {
          calibration: assessCalibration(
            calibration,
            intent.packet,
            intent.routes,
            outcomes
          ),
        }
      : {}),
    campaignIntentHash: intentHash,
    instrumentQualified: false,
    outcomes,
    qualified: false,
    scope: "development-ai-review" as const,
  };
};

export const writeAiReviewAssessment = (
  campaign: string,
  out: string,
  calibration?: AiCalibrationAssessmentOptions
) => {
  const assessment = assessAiReviewCampaign(campaign, calibration);
  writeFileSync(out, `${JSON.stringify(assessment, null, 2)}\n`, {
    flag: "wx",
  });
  return assessment;
};
