import {
  analogArm,
  compose,
  describeProposal,
  exceedsCostBudget,
  EXPERT_IDS,
  generate as generateIcon,
  gatewayHarnessSpawn,
  gatewayAsk,
  harnessArm,
  compileArm,
  parseIconSvg,
  QUALITY_MODEL,
  png,
  propose,
  rankPairCandidates,
  referenceSet,
  runPairTournament,
  totalUsd,
} from "iconsmith";
import type { ApiCost, AuditResult, ExpertId, PairCandidate } from "iconsmith";

import { loadStudioArsenal } from "./arsenal";
import { conceptOf, isVague } from "./concept";
import type {
  StudioActivity,
  StudioAgentRun,
  StudioIssue,
  StudioQuestion,
  StudioRequest,
  StudioResponse,
  StudioVersion,
} from "./types";

const CLARIFY: StudioQuestion[] = [
  {
    description: "The object noun, not the intent. search is a magnifying glass.",
    freeform: true,
    id: "object",
    title: "What object should I draw?",
  },
  {
    choices: [
      { label: "Outlined — the set's main variant", value: "outlined" },
      { label: "Filled — the solid twin", value: "filled" },
    ],
    description: "I will still produce both paints. This picks which one leads.",
    id: "finish",
    optional: true,
    title: "Which paint leads?",
  },
  {
    description: "A short note the drawer can treat as a tag, not geometry.",
    freeform: true,
    id: "notes",
    optional: true,
    title: "Anything else I should know?",
  },
];

/** 9.75 admits only a pair whose weakest SC/PQ score is effectively perfect.
 * It keeps a 9.9 licensed house pair and escalates an merely acceptable 8.x
 * pair to the generative arsenal. */
const CONFIDENT_PAIR_SCORE = 9.75;
const IMAGE_AGENT_MAX_STEPS = 7;
const IMAGE_AGENT_MAX_USD_PER_PAINT = 0.05;
const IMAGE_AGENT_MODEL = "google/gemini-3.7-flash";
const GATEWAY_AGENT_MODEL = "google/gemini-3.7-flash";
const GATEWAY_AGENT_MAX_STEPS = 16;
const HARNESS_MODEL = "anthropic/claude-sonnet-5";
/** Set on a machine whose Eve server can spawn the Claude Code CLI, which
 *  bills the subscription rather than the Gateway. Off by default so a
 *  deployed server never tries to exec a binary it does not have. */
const LOCAL_HARNESS = process.env.ICONSMITH_LOCAL_HARNESS === "1";
/**
 * How many cheap sketches the proposal stage draws before one is chosen.
 *
 * Two, plus the quality model, is three references and a `proposal-selection`
 * pass over them — and that is the one structural difference between the
 * campaign's single accepted pair and every attempt since. `gpr` proposed
 * three (two `gemini-3.1-flash-lite-image`, one `gemini-3-pro-image`), ran the
 * critique, and scored 10/10. `dna` proposed one, skipped the critique, and
 * thrashed to 3.2/10 on the same expensive drawing model. The discriminator is
 * the reference, not the draughtsman.
 */
const PROPOSAL_IDEAS = 2;

/** The shared proposal stage, from the `gpr` ledger: two flash sketches at
 *  $0.035, one pro sketch at $0.153, the selection pass at $0.045 and the
 *  reading at $0.012. Reserved by both arms that can trigger it, because the
 *  run is memoised and either one may be the caller that pays for it. */
const PROPOSAL_RESERVE_USD = 0.3;
const PROPOSAL_RESERVE_CALLS = 5;

const PAIR_AUDIT_RESERVE_USD = 0.055;
const IMAGE_PAIR_RESERVE_CALLS = IMAGE_AGENT_MAX_STEPS * 2 + 4;
const IMAGE_PAIR_RESERVE_USD = 0.195;

/**
 * What the generative arms cost at the models they are actually configured
 * with, not at the ones they used to run.
 *
 * `gateway-agent` reserved $1.50 and `claude-harness` $1.00 — figures sized
 * for `claude-opus-5`, which is what drew the campaign's one accepted pair.
 * Both now run cheaper models, but the reservations never moved, and a
 * reservation is checked before an arm may start. Against the $0.25 per-icon
 * default that made the two strongest arms permanently unreachable: only
 * `host-analog` ($0.055) and `image-agent` ($0.195) could ever be admitted,
 * and they sum to exactly the budget. Every attempt after the guardrail was a
 * two-arm race no matter what was asked for.
 *
 * Measured from the campaign ledger: 14 `gemini-3.7-flash` generation calls
 * billed $0.0659, so ~$0.005 a call. These keep roughly a 2x margin over that
 * and stay fail-closed — `recordActual` and `exceedsCostBudget` still reject a
 * run whose real ledger overruns.
 */
const GATEWAY_PAIR_RESERVE_CALLS = GATEWAY_AGENT_MAX_STEPS * 2 + 2;
const GATEWAY_PAIR_RESERVE_USD = 0.35;
const HARNESS_PAIR_RESERVE_CALLS = 8 + PROPOSAL_RESERVE_CALLS;
const HARNESS_PAIR_RESERVE_USD = 0.4 + PROPOSAL_RESERVE_USD;

/** What a complete four-arm tournament reserves. `backlog.mjs` sizes its
 *  per-icon default from this number; a budget below it cannot buy the arms
 *  that draw, and the tournament now names the ones it had to refuse. */
export const PAIR_TOURNAMENT_RESERVE_USD =
  PAIR_AUDIT_RESERVE_USD +
  IMAGE_PAIR_RESERVE_USD +
  GATEWAY_PAIR_RESERVE_USD +
  HARNESS_PAIR_RESERVE_USD;
export const PAIR_TOURNAMENT_RESERVE_CALLS =
  2 + IMAGE_PAIR_RESERVE_CALLS + GATEWAY_PAIR_RESERVE_CALLS + HARNESS_PAIR_RESERVE_CALLS;

const asIssues = (
  issues: readonly {
    declared?: string;
    message: string;
    rule: string;
    severity: string;
  }[],
): StudioIssue[] =>
  issues
    .filter((issue) => issue.severity === "error" || issue.severity === "warn")
    .map((issue) => ({
      ...(issue.declared ? { declared: issue.declared } : {}),
      message: issue.message,
      rule: issue.rule,
      severity: issue.severity as "error" | "warn",
    }));

const visualProposal = (request: StudioRequest) => {
  const attachment = request.attachments?.find(
    (file) => (file.kind === "image" || file.kind === "svg") && file.dataUrl,
  );
  if (!attachment?.dataUrl) {
    return null;
  }
  const separator = attachment.dataUrl.indexOf(",");
  const header = attachment.dataUrl.slice(0, separator);
  const payload = attachment.dataUrl.slice(separator + 1);
  if (
    separator === -1 ||
    !/^data:image\/[\w.+-]+;base64$/iu.test(header) ||
    !/^[a-z\d+/=]+$/iu.test(payload) ||
    payload.length > 2_100_000
  ) {
    throw new Error("That visual reference could not be read safely.");
  }
  return compose(Buffer.from(payload, "base64"), { model: null });
};

const selectedExpert = (trace: readonly string[], attempted: readonly ExpertId[]): ExpertId => {
  const head = trace[0] ?? "";
  return EXPERT_IDS.find((id) => head.endsWith(`/${id}`)) ?? attempted.at(-1) ?? "agent";
};

const agentRun = (
  selected: ExpertId,
  attempted: readonly ExpertId[],
  reviewed: AuditResult,
): StudioAgentRun => ({
  attempted: [...attempted],
  findings: [...reviewed.findings],
  // Always "review": the tournament scores every paint with a fresh audit the
  // drawing arm did not supply, so no delivered pair is self-graded any more.
  // The enum keeps "draw-and-review" so archived artifacts still parse.
  mode: "review",
  ok: reviewed.ok,
  pq: reviewed.pq,
  reason: reviewed.reason,
  sc: reviewed.sc,
  scorable: reviewed.scorable,
  selected,
});

const costSummary = (costs: readonly ApiCost[]) => ({
  calls: costs.reduce((sum, cost) => sum + cost.calls, 0),
  records: costs.map(({ calls, generationIds, model, operation, source, usage, usd }) => ({
    calls,
    generationIds,
    model,
    operation,
    source,
    usage,
    usd,
  })),
  totalUsd: totalUsd(costs),
  unpricedCalls: costs
    .filter((cost) => cost.usd === null)
    .reduce((sum, cost) => sum + cost.calls, 0),
});

const candidateCosts = (
  candidate: Awaited<ReturnType<typeof runPairTournament>>["candidates"][number],
): ApiCost[] =>
  candidate.paints.flatMap((paint) => [
    ...(paint.result.apiCosts ?? []),
    ...(paint.audit.cost ? [paint.audit.cost] : []),
  ]);

const costText = (usd: number | null): string =>
  usd === null ? "with an incomplete cost total" : `for $${usd.toFixed(4)}`;

export interface GenerateStudioOptions {
  /** Eve turn cancellation, threaded through every paid pipeline call. */
  readonly abortSignal?: AbortSignal;
  /**
   * Told where the run has got to, as a complete list every time.
   *
   * A snapshot, never a delta. The tool publishes these as `action.partial`,
   * whose contract is "last-write-wins by tool call id, not append-only",
   * because the durable runtime replays. Sending the whole list makes a
   * replayed partial idempotent; sending a delta would append a second copy of
   * every row, which is a bug this transcript has already worn once.
   */
  readonly onActivity?: (activities: readonly StudioActivity[]) => void;
  /** Stable Eve session/turn id when invoked as a durable tool; random for direct HTTP calls. */
  readonly operationId?: string;
}

/**
 * One ordered list of rows, published whole on every change.
 *
 * Rows are keyed, so a phase that reports four times — an arm starting, each
 * paint drawn, each paint reviewed, the pair settling — moves one row through
 * its states rather than stacking four.
 */
const activityLedger = (onActivity: GenerateStudioOptions["onActivity"]) => {
  const rows: StudioActivity[] = [];
  const publish = (): void => {
    if (!onActivity) {
      return;
    }
    try {
      onActivity([...rows]);
    } catch {
      // Reporting is telemetry. A run that has already spent money must not be
      // lost because something downstream wanted to draw a row.
    }
  };
  return {
    note(row: StudioActivity): void {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index === -1) {
        rows.push(row);
      } else {
        rows[index] = row;
      }
      publish();
    },
  };
};

const libraryCandidates = (
  concept: { name: string; tags: string[] },
  arsenal: Awaited<ReturnType<typeof loadStudioArsenal>>,
): PairCandidate[] => {
  const references = new Map(arsenal.references.map((reference) => [reference.name, reference]));
  return arsenal.references
    .filter(
      (reference) =>
        reference.name.startsWith(`${concept.name}-`) &&
        !reference.name.endsWith("-filled") &&
        references.has(`${reference.name}-filled`),
    )
    .map((reference) => ({
      generate: (paint) => {
        const source = references.get(
          paint === "filled" ? `${reference.name}-filled` : reference.name,
        );
        if (!source) {
          throw new Error(`${reference.name} has no ${paint} library twin.`);
        }
        return compileArm()(concept, {
          finish: paint,
          parts: arsenal.parts,
          targetPaths: parseIconSvg(source.svg).map((shape) => shape.d),
        });
      },
      id: `library-${reference.name}`,
      label: `Existing library · ${reference.name}`,
      reserveCalls: 2,
      reserveUsd: PAIR_AUDIT_RESERVE_USD,
    }));
};

// oxlint-disable-next-line eslint/complexity -- one orchestration owns approval, proposal, tournament, and response assembly
export const generateStudioResponse = async (
  request: StudioRequest,
  options: GenerateStudioOptions = {},
): Promise<StudioResponse> => {
  options.abortSignal?.throwIfAborted();
  const { finish, name, tags } = conceptOf(request);
  if (name === "icon" || (isVague(request.text) && !request.answers?.object)) {
    return {
      items: [...CLARIFY],
      kind: "questions",
      text: "A couple of questions before I start. I draw the object, not the intent.",
    };
  }

  /**
   * Consent is enforced by the tool's `approval` gate, which parks the durable
   * session before `execute` runs. Reaching this line means the user approved,
   * so there is nothing left to ask in-band.
   */
  const hasVisualRefs = request.attachments?.some(
    (file) => file.kind === "image" || file.kind === "svg",
  );

  const concept = { name, tags };
  const attachedProposal = hasVisualRefs ? await visualProposal(request) : null;
  const arsenal = await loadStudioArsenal(concept);
  const referenceSlots = referenceSet(arsenal.references, { concept: name, tags });
  const referenceImages = await Promise.all(
    referenceSlots.all.map((reference) => png(reference.svg, 96)),
  );

  const ledger = activityLedger(options.onActivity);
  ledger.note({
    detail: `Reading ${arsenal.references.length} licensed house icons for reference.`,
    id: "arsenal",
    label: "Gathering the house reference set",
    state: "complete",
  });

  let generatedProposal: Awaited<ReturnType<typeof propose>> | null = null;
  let proposalFailure: string | null = null;
  let proposal = attachedProposal;
  let proposalPromise: Promise<typeof proposal> | null = null;
  const ensureProposal = (): Promise<typeof proposal> => {
    if (proposal) {
      return Promise.resolve(proposal);
    }
    proposalPromise ??= (async () => {
      ledger.note({
        detail: `Drawing ${PROPOSAL_IDEAS} cheap sketches plus one from the quality model, then choosing between them.`,
        id: "proposal",
        label: "Proposing a composition",
        state: "active",
      });
      try {
        const run = await propose(concept, {
          abortSignal: options.abortSignal,
          corpus: arsenal.references,
          ideas: PROPOSAL_IDEAS,
          parts: arsenal.parts,
          qualityModel: QUALITY_MODEL,
        });
        generatedProposal = run;
        ({ proposal } = run);
        ledger.note({
          detail: `Chose sketch ${run.chosen + 1} of ${run.images.length}, from ${run.references.length} licensed house icons.`,
          id: "proposal",
          label: "Chose a composition",
          state: "complete",
        });
      } catch (error) {
        proposalFailure = error instanceof Error ? error.message : "Image proposal failed.";
        ledger.note({
          detail: proposalFailure,
          id: "proposal",
          label: "Could not propose a composition",
          state: "failed",
        });
      }
      return proposal;
    })();
    return proposalPromise;
  };
  const batchId = `${name}-${options.operationId ?? crypto.randomUUID()}`;
  const paints =
    finish === "filled" ? (["filled", "outlined"] as const) : (["outlined", "filled"] as const);
  const common = {
    abortSignal: options.abortSignal,
    corpus: arsenal.references,
    forceAgent: true,
    lookReferences: referenceImages,
    parts: arsenal.parts,
  } as const;
  // The local Claude Code CLI when this process has one, the metered Gateway
  // adapter otherwise. `PLAN.md` sizes the campaign around $0.00 marginal
  // generation through the subscription, and the campaign runs against a local
  // Eve dev server where the CLI is on PATH — but the deployed server has
  // neither a CLI nor a subscription, so the choice is opted into by name
  // rather than sniffed from the filesystem. A harness that silently changed
  // what it billed between two machines would be worse than either.
  const claude = harnessArm({
    ask: gatewayAsk,
    command: "claude",
    repairs: 2,
    ...(LOCAL_HARNESS ? {} : { spawn: gatewayHarnessSpawn({ model: HARNESS_MODEL }) }),
  });
  const libraryArms = libraryCandidates(concept, arsenal);
  ledger.note({
    detail:
      libraryArms.length > 0
        ? `Ranking ${libraryArms.length} existing library pair${libraryArms.length === 1 ? "" : "s"} before drawing anything new.`
        : "The set draws nothing under this name, so every arm is a fresh drawing.",
    id: "ranking",
    label: "Ranking existing library pairs",
    state: "active",
  });
  const ranking = await rankPairCandidates({
    abortSignal: options.abortSignal,
    candidates: libraryArms,
    concept,
  });
  ledger.note({
    detail: ranking.reason ?? undefined,
    id: "ranking",
    label:
      libraryArms.length > 0
        ? "Ranked the existing library pairs"
        : "No existing library pair to rank",
    state: "complete",
  });
  const candidates: PairCandidate[] = [
    ...ranking.candidates,
    {
      generate: (paint) =>
        analogArm()(concept, {
          corpus: arsenal.references,
          finish: paint,
          parts: arsenal.parts,
        }),
      id: "host-analog",
      label: "Host analog baseline",
      reserveCalls: 2,
      reserveUsd: PAIR_AUDIT_RESERVE_USD,
    },
    {
      generate: async (paint) => {
        const imageProposal = await ensureProposal();
        if (!imageProposal) {
          throw new Error(proposalFailure ?? "Image proposal was unavailable.");
        }
        return generateIcon(concept, {
          ...common,
          finish: paint,
          maxSteps: IMAGE_AGENT_MAX_STEPS,
          maxUsd: IMAGE_AGENT_MAX_USD_PER_PAINT,
          model: IMAGE_AGENT_MODEL,
          proposal: imageProposal,
          select: "contrast",
        });
      },
      id: "image-agent",
      label: "Image-guided Gateway agent",
      reserveCalls: IMAGE_PAIR_RESERVE_CALLS + PROPOSAL_RESERVE_CALLS,
      reserveUsd: IMAGE_PAIR_RESERVE_USD + PROPOSAL_RESERVE_USD,
      serial: true,
    },
    {
      generate: (paint) =>
        generateIcon(concept, {
          ...common,
          finish: paint,
          maxSteps: GATEWAY_AGENT_MAX_STEPS,
          model: GATEWAY_AGENT_MODEL,
          proposal: null,
          select: "slug",
        }),
      id: "gateway-agent",
      label: "Vercel Gateway tool agent",
      reserveCalls: GATEWAY_PAIR_RESERVE_CALLS,
      reserveUsd: GATEWAY_PAIR_RESERVE_USD,
    },
    {
      generate: async (paint) =>
        claude(concept, {
          ...common,
          finish: paint,
          proposal: await ensureProposal(),
          select: "slug",
        }),
      id: "claude-harness",
      label: "Claude Gateway code harness + repair",
      reserveCalls: HARNESS_PAIR_RESERVE_CALLS,
      reserveUsd: HARNESS_PAIR_RESERVE_USD,
      serial: true,
    },
  ];
  const rankingCalls = ranking.cost?.calls ?? 0;
  const rankingUsd = ranking.cost ? totalUsd([ranking.cost]) : 0;
  const budget = request.budget
    ? {
        maxCalls: Math.max(0, request.budget.maxCalls - rankingCalls),
        maxUsd: Math.max(0, request.budget.maxUsd - (rankingUsd ?? request.budget.maxUsd)),
      }
    : undefined;
  const tournament = await runPairTournament({
    abortSignal: options.abortSignal,
    ask: gatewayAsk,
    budget,
    candidates,
    concept,
    /**
     * The arms are where the minutes go, so this is where the transcript used
     * to fall silent. One row per arm, moved through its phases rather than
     * stacked, and `arm N of M` so a reader can place themselves in the field.
     */
    onProgress(event) {
      const seat = `Arm ${event.index} of ${event.total} · ${event.label}`;
      if (event.phase === "started") {
        ledger.note({
          detail: "Drawing the outlined and filled pair.",
          id: `arm:${event.candidateId}`,
          label: seat,
          state: "active",
        });
        return;
      }
      if (event.phase === "painted") {
        ledger.note({
          detail: `Drew the ${event.finish} paint.`,
          id: `arm:${event.candidateId}`,
          label: seat,
          state: "active",
        });
        return;
      }
      if (event.phase === "reviewed") {
        ledger.note({
          detail: `Reviewed the ${event.finish} paint — SC ${event.sc}/10, PQ ${event.pq}/10.`,
          id: `arm:${event.candidateId}`,
          label: seat,
          state: "active",
        });
        return;
      }
      if (event.failure) {
        ledger.note({
          detail: event.failure,
          id: `arm:${event.candidateId}`,
          label: `${seat} could not produce a complete pair`,
          state: "failed",
        });
        return;
      }
      ledger.note({
        // A rejected arm is not a failed one: it drew a pair and the pair was
        // judged. `failed` is reserved for an arm that could not draw at all.
        detail: `${event.accepted ? "Accepted" : "Rejected"} at ${event.score}/10.`,
        id: `arm:${event.candidateId}`,
        label: seat,
        state: "complete",
      });
    },
    parts: arsenal.parts,
    references: referenceImages,
    stopScore: CONFIDENT_PAIR_SCORE,
  });
  ledger.note({
    detail: tournament.winner
      ? `${tournament.winner.label} cleared every gate at ${tournament.winner.score}/10.`
      : `No pair cleared SC ${tournament.minimum.sc}/10 and PQ ${tournament.minimum.pq}/10 on both paints.`,
    id: "verdict",
    label: tournament.winner ? "Chose a pair" : "Rejected every candidate",
    state: tournament.winner ? "complete" : "failed",
  });
  // The lazy closure is the only writer; TypeScript does not carry that
  // mutation across the awaited tournament call.
  const completedProposal = generatedProposal as Awaited<ReturnType<typeof propose>> | null;
  const proposalCosts = completedProposal?.costs ?? [];
  const runCosts = tournament.candidates.flatMap(candidateCosts);
  const rankingCosts = ranking.cost ? [ranking.cost] : [];
  const allCosts = [...rankingCosts, ...proposalCosts, ...runCosts];
  const accountedCost = costSummary(allCosts);
  // A pair can fail after one provider call completes but before its
  // GenerateResult is available. The tournament marks that ledger unknown;
  // keep the Studio total unknown too instead of presenting the visible
  // records as a complete total.
  const measuredCost =
    tournament.budget?.actualUsd === null
      ? {
          ...accountedCost,
          totalUsd: null,
          unpricedCalls: Math.max(1, accountedCost.unpricedCalls),
        }
      : accountedCost;
  const measuredBudgetOverrun = request.budget
    ? exceedsCostBudget({ calls: measuredCost.calls, usd: measuredCost.totalUsd }, request.budget)
    : false;
  const completeBudget = request.budget
    ? {
        actualCalls: measuredCost.calls,
        actualUsd: measuredCost.totalUsd,
        exhausted: tournament.budget?.exhausted === true || measuredBudgetOverrun,
        maxCalls: request.budget.maxCalls,
        maxUsd: request.budget.maxUsd,
        overrun: tournament.budget?.overrun === true || measuredBudgetOverrun,
        reservedCalls: rankingCalls + (tournament.budget?.reservedCalls ?? 0),
        reservedUsd: (rankingUsd ?? request.budget.maxUsd) + (tournament.budget?.reservedUsd ?? 0),
      }
    : null;
  const tournamentSummary = {
    candidates: tournament.candidates.map((candidate) => ({
      accepted: candidate.accepted,
      cost: costSummary(candidateCosts(candidate)),
      failure: candidate.failure?.slice(0, 1000) ?? null,
      id: candidate.id,
      label: candidate.label,
      paints: candidate.paints.map((paint) => ({
        accepted: paint.accepted,
        apiCosts: paint.result.apiCosts ?? [],
        brief: paint.result.brief ?? null,
        clean: paint.result.clean,
        document: paint.result.doc,
        findings: paint.audit.findings,
        finish: paint.finish,
        generation: paint.result.cost ?? null,
        issues: asIssues(paint.result.issues),
        pq: paint.audit.pq,
        program: paint.result.program ?? null,
        programComplete: paint.programComplete,
        reason: paint.audit.reason,
        sc: paint.audit.sc,
        scorable: paint.audit.scorable,
        steps: paint.result.steps,
        svg: paint.result.svg,
        text: paint.result.text,
        trace: paint.result.trace,
      })),
      score: candidate.score,
    })),
    cost: measuredCost,
    minimum: tournament.minimum,
    proposal: completedProposal
      ? {
          chosen: completedProposal.chosen,
          cost: costSummary(proposalCosts),
          images: completedProposal.images.length,
          models: completedProposal.models,
          previews: completedProposal.images.map((image) => image.toString("base64")),
          reason: completedProposal.reason,
          references: completedProposal.references,
        }
      : null,
    proposalFailure,
    ranking: {
      order: ranking.order,
      reason: ranking.reason,
    },
    selected: measuredBudgetOverrun
      ? "none"
      : (tournament.winner?.id ?? tournament.best?.id ?? "none"),
    strategy: {
      budget: completeBudget,
      eligible: tournament.eligible,
      evaluated: tournament.candidates.length,
      stopScore: CONFIDENT_PAIR_SCORE,
      stoppedEarly: tournament.stoppedEarly,
      unaffordable: tournament.unaffordable,
    },
  };
  if (measuredBudgetOverrun) {
    return {
      kind: "error",
      text:
        `I stopped “${name}” in revision because the measured run crossed ` +
        `the requested automatic budget after an in-flight provider call ` +
        `${costText(measuredCost.totalUsd)} across ${measuredCost.calls} billed API calls. ` +
        "No candidate can be delivered while any cost is unknown or over budget.",
      tournament: tournamentSummary,
    };
  }
  if (!tournament.winner) {
    const { best } = tournament;
    const quality = best
      ? ` The best pair was ${best.label} at ${best.score.toFixed(1)}/10.`
      : " Every candidate arm failed before it produced a pair.";
    // Name the arms the budget refused. "The budget was exhausted" reads like
    // the run tried everything and ran out; three campaign attempts said that
    // while never having been allowed to start the two arms that draw.
    const refused =
      tournament.unaffordable.length > 0
        ? ` It never ran ${tournament.unaffordable.join(", ")}: the per-icon budget could not reserve ${tournament.unaffordable.length === 1 ? "that arm" : "those arms"}.`
        : "";
    const next = completeBudget?.exhausted
      ? `${refused} The automatic cost budget was exhausted, so the pair remains in revision; rerun it with an explicit larger per-icon budget to escalate.`
      : " Try a more specific object noun or attach a composition reference.";
    return {
      kind: "error",
      text: `I rejected every candidate for “${name}” instead of returning another weak icon.${quality}${next}`,
      tournament: tournamentSummary,
    };
  }

  const { winner } = tournament;
  const drawn = paints.map((paint) => {
    const winnerPaint = winner.paints.find((candidate) => candidate.finish === paint);
    if (!winnerPaint) {
      throw new Error(`${winner.label} returned no ${paint} paint.`);
    }
    const { result } = winnerPaint;
    const selected = selectedExpert(result.trace, []);
    const attempted: ExpertId[] = [selected];
    const version: StudioVersion = {
      agent: agentRun(selected, attempted, winnerPaint.audit),
      batchId,
      brief: `${winner.label} · selected from ${tournament.candidates.length} candidate pairs`,
      clean: result.clean,
      document: result.doc,
      finish: paint,
      id: `${batchId}-${paint}`,
      issues: asIssues(result.issues),
      name,
      program: result.program ?? "",
      programComplete: winnerPaint.programComplete,
      steps: result.steps,
      svg: result.svg,
      trace: [`tournament/${winner.id}`, ...result.trace],
    };
    return version;
  });

  const referenceNote = proposal
    ? ` Reference read: ${describeProposal(proposal).replaceAll("\n", " ").slice(0, 240)}`
    : "";
  const text = `${winner.label} won a ${tournament.candidates.length}-pair tournament at ${winner.score.toFixed(1)}/10 ${costText(measuredCost.totalUsd)} across ${measuredCost.calls} billed API calls. Both paints cleared SC ${tournament.minimum.sc}/10, PQ ${tournament.minimum.pq}/10, lint, and zero-finding gates.${referenceNote}`;
  return {
    kind: "drawn",
    text,
    tournament: tournamentSummary,
    versions: drawn,
  };
};
