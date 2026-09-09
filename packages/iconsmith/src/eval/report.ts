import type { AcceptanceReport } from "./acceptance-contract.js";
import { validateAcceptanceReport } from "./acceptance-contract.js";
/**
 * The metric panel, assembled and printed.
 *
 * Four axes, read in a fixed order, because the order encodes what each one is
 * allowed to do:
 *
 * 1. **Conformance** is a gate. An icon with a lint error is disqualified and
 *    its other three numbers are not reported. It is never averaged into
 *    anything — a centred rounded rect lints clean, and a headline that
 *    rewarded that would be rewarding drawing nothing.
 * 2. **Style** — does it look like it belongs, with the concept closure removed
 *    from the neighbourhood so this is not reconstruction wearing a hat.
 * 3. **Semantic** — does it read as the concept, as a rank over the concept
 *    bank against the ceiling the *real* icon reaches.
 * 4. **Judge** — a VIEScore-style read, printed only if the judge cleared its
 *    sanity gate.
 *
 * Each reports `reach = (treatment − floor) / (baseline − floor)` as its single
 * headline. There is deliberately **no combined headline across the four.**
 * Averaging a rank@1 against a DINO cosine against a 0–10 judge score produces
 * a number with no unit that moves for reasons a reader cannot recover, and the
 * point of the panel is that four different ways of being wrong stay
 * distinguishable.
 */
import type { Calibration } from "./calibration.js";
import { isMeasured } from "./calibration.js";
import type { GateResult } from "./judge.js";
import type { Panel, PanelReading } from "./panel.js";
import { formatPanel, read } from "./panel.js";
import type { Separation } from "./separation.js";

export interface PanelTreatments {
  /** Median VIEScore, 0–10. Null when no judge ran. */
  judge: number | null;
  /** Share of scored icons whose top concept was their own. Null with no
   *  SigLIP sidecars. */
  semantic: number | null;
  /** Median style score. Null with no DINO sidecars. */
  style: number | null;
  /** Share of scored icons with no lint error. */
  conformanceGate: number;
  /** Share with no lint issue of any severity. */
  conformanceStrict: number;
}

export interface MetricReport {
  /** The section-3 acceptance envelope is reported beside the legacy metric
   * panel. Its absence is an explicit unqualified result. */
  acceptance: {
    contractVersion: string | null;
    envelopeValid: boolean;
    evidencePresent: boolean;
    qualification: false;
    reasons: readonly string[];
  };
  /** The scales every reading above was taken against, carried with the report
   *  so a formatter, a JSON consumer or a reader six months from now has the
   *  floor beside the number rather than in another file. */
  calibration: Calibration;
  /** How many icons were disqualified by the gate before the other metrics
   *  were read. Reported, never hidden: a pipeline that gets a good style
   *  score on the three icons that survived is not a good pipeline. */
  disqualified: number;
  conformance: { gate: PanelReading; strict: PanelReading };
  /** Null when the judge did not clear its sanity gate, plus the verdict
   *  saying so. */
  judge: PanelReading | null;
  judgeGate: GateResult | null;
  /** Icons whose metrics were read — the ones that cleared the gate. */
  n: number;
  semantic: PanelReading | null;
  style: PanelReading | null;
  /** Sentences explaining every null above. A metric that silently vanishes
   *  from a report reads as a metric that scored badly. */
  unavailable: string[];
}

/**
 * The judge's own scale. Unlike the other three this is not measured against a
 * corpus, because a 0–10 rubric has no corpus: the anchors in `JUDGE_SYSTEM`
 * *are* the calibration. Floor and ceiling are therefore the rubric's own
 * anchors, stated here rather than measured, and the baseline is the "sound but
 * with a visible awkwardness" anchor at 7 — which is the rubric's description
 * of a competent professional icon.
 *
 * √(7 × 7) = 7, so the baseline is 7 on the combined scale too.
 */
const JUDGE_SCALE = { baseline: 7, ceiling: 10, floor: 0 } as const;

/**
 * The judge gate for a given model, out of the calibration's run log.
 *
 * A gate measured against Haiku says nothing about Sonnet — measured on this
 * corpus the two land either side of the 90% bar — so the run is selected by
 * model rather than "the most recent" or "any that passed".
 */

/** The separation verdict for a metric, for printing beside its panel. */
const separationLine = (s: Separation): string => `    ${s.verdict}`;

const panel = (
  floor: number,
  baseline: number,
  ceiling: number,
  treatment: number | null,
  n: number
): Panel => ({ baseline, ceiling, floor, n, treatment });

export const buildReport = (
  calibration: Calibration,
  treatments: PanelTreatments,
  counts: { disqualified: number; n: number },
  judgeGate: GateResult | null,
  acceptanceEvidence?: AcceptanceReport
): MetricReport => {
  const unavailable: string[] = [];
  const conf = calibration.conformance;

  let style: PanelReading | null = null;
  if (isMeasured(calibration.style)) {
    const c = calibration.style;
    if (c.separation.usable) {
      style = read(
        panel(c.floor, c.baseline, c.ceiling, treatments.style, counts.n)
      );
      if (treatments.style === null) {
        unavailable.push(
          "style: calibrated, but no DINO embedding for the candidates. Run " +
            "`scripts/embed.py --model dino` over the generated SVGs."
        );
      }
    } else {
      // Same discipline as the judge gate: an instrument that cannot answer the
      // easy question does not get a column. Reporting a reach against a scale
      // 0.003 wide would be reporting the sampling noise, amplified.
      unavailable.push(c.separation.verdict);
    }
  } else {
    unavailable.push(`style: ${calibration.style.note}`);
  }

  let semantic: PanelReading | null = null;
  if (isMeasured(calibration.semantic)) {
    const c = calibration.semantic;
    if (c.separation.usable) {
      semantic = read(
        panel(c.floor, c.baseline, c.ceiling, treatments.semantic, counts.n)
      );
      if (treatments.semantic === null) {
        unavailable.push(
          "semantic: calibrated, but no SigLIP embedding for the candidates. Run " +
            "`scripts/embed.py --model siglip-image` over the generated SVGs."
        );
      }
    } else {
      unavailable.push(c.separation.verdict);
    }
  } else {
    unavailable.push(`semantic: ${calibration.semantic.note}`);
  }

  let judge: PanelReading | null = null;
  if (judgeGate?.passed) {
    judge = read(
      panel(
        JUDGE_SCALE.floor,
        JUDGE_SCALE.baseline,
        JUDGE_SCALE.ceiling,
        treatments.judge,
        counts.n
      )
    );
  } else if (judgeGate) {
    unavailable.push(`judge: ${judgeGate.verdict}`);
  } else {
    unavailable.push(
      "judge: not run. The judge column is only reported after it clears its " +
        "sanity gate, so a run with no gate has no judge column."
    );
  }

  const acceptance = acceptanceEvidence
    ? {
        contractVersion: acceptanceEvidence.contractVersion,
        evidencePresent: true,
        ...validateAcceptanceReport(acceptanceEvidence),
      }
    : {
        contractVersion: null,
        envelopeValid: false,
        evidencePresent: false,
        qualification: false as const,
        reasons: ["Acceptance evidence was not supplied"],
      };

  return {
    acceptance,
    calibration,
    conformance: {
      gate: read(
        panel(
          conf.floor.gate,
          conf.baseline.gate,
          conf.ceiling.gate,
          treatments.conformanceGate,
          counts.n + counts.disqualified
        )
      ),
      strict: read(
        panel(
          conf.floor.strict,
          conf.baseline.strict,
          conf.ceiling.strict,
          treatments.conformanceStrict,
          counts.n + counts.disqualified
        )
      ),
    },
    disqualified: counts.disqualified,
    judge,
    judgeGate,
    n: counts.n,
    semantic,
    style,
    unavailable,
  };
};

export const formatMetrics = (report: MetricReport): string => {
  const { calibration } = report;
  const conf = calibration.conformance;
  const lines: string[] = [
    `metric panel — ${report.n} scored, ${report.disqualified} disqualified by the conformance gate`,
    `  calibrated ${calibration.builtAt.slice(0, 10)} over ${calibration.records} records`,
    `  acceptance — ${report.acceptance.qualification ? "qualified" : "UNQUALIFIED"}${report.acceptance.contractVersion ? ` (${report.acceptance.contractVersion})` : " (no evidence)"}`,
    ...report.acceptance.reasons.map((reason) => `    ${reason}`),
    "",
    "  conformance — a GATE, never averaged into a score",
    ...formatPanel(
      "  gate — no lint error; below this an icon is disqualified",
      report.conformance.gate,
      {
        baseline: `${conf.baseline.set}, the best third-party stroke pack`,
        ceiling: `${conf.ceiling.set}'s own rate — not 1, and that is the finding`,
        floor: `${conf.floor.sets.length} third-party stroke packs pooled over ${conf.floor.n} icons`,
      },
      false
    ),
    ...formatPanel(
      "  strict — no issue of any severity; where the house spec actually lives",
      report.conformance.strict,
      {
        baseline: `${conf.baseline.set}`,
        ceiling: `${conf.ceiling.set} over ${conf.ceiling.n} icons`,
        floor: "third-party stroke packs pooled",
      },
      false
    ),
    `    excluded from the floor: ${conf.excluded.map((e) => `${e.set} (${e.reason})`).join("; ")}`,
  ];

  if (report.style && isMeasured(calibration.style)) {
    const c = calibration.style;
    lines.push(
      "",
      ...formatPanel("style (DINO ViT-B/8, k=10)", report.style, {
        baseline: `third-party icon of the same concept (n=${c.baselineN})`,
        ceiling: `held-out house icon vs the rest of the house set (n=${c.ceilingN})`,
        floor: `third-party icon of an unrelated concept (n=${c.floorN})`,
      }),
      separationLine(c.separation)
    );
  }
  if (report.semantic && isMeasured(calibration.semantic)) {
    const c = calibration.semantic;
    lines.push(
      "",
      ...formatPanel(
        `semantic (SigLIP rank@1 over ${c.bank} concepts)`,
        report.semantic,
        {
          baseline: `third-party icon of the same concept (n=${c.baselineN})`,
          ceiling: `the real shipped icon (n=${c.ceilingN}) — not 100%`,
          floor: `a different house icon asked the same question (n=${c.floorN})`,
        }
      ),
      separationLine(c.separation)
    );
  }
  if (report.judge) {
    lines.push(
      "",
      ...formatPanel("judge (√(SC × PQ), 0–10)", report.judge, {
        baseline: "the rubric's 'competent professional icon' anchor",
        ceiling: "the rubric's top anchor",
        floor: "the rubric's bottom anchor",
      }),
      `    ${report.judgeGate?.verdict ?? ""}`
    );
  }
  if (report.unavailable.length > 0) {
    lines.push(
      "",
      "  not reported:",
      ...report.unavailable.map((u) => `    ${u}`)
    );
  }
  return lines.join("\n");
};
