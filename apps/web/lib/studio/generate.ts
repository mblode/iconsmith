import {
  compose,
  describeProposal,
  EXPERT_IDS,
  generate as generateIcon,
  gatewayHarnessSpawn,
  gatewayAsk,
  harnessArm,
  mixtureArm,
  compileArm,
  parseIconSvg,
  png,
  propose,
  QUALITY_MODEL,
  rankPairCandidates,
  referenceSet,
  runPairTournament,
  totalUsd,
} from "iconsmith";
import type { ApiCost, AuditResult, ExpertId, PairCandidate } from "iconsmith";

import { loadStudioArsenal } from "./arsenal";
import { conceptOf, isVague } from "./concept";
import type {
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

const asIssues = (
  issues: readonly { message: string; rule: string; severity: string }[],
): StudioIssue[] =>
  issues
    .filter((issue) => issue.severity === "error" || issue.severity === "warn")
    .map((issue) => ({
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
  mode: selected === "agent" ? "draw-and-review" : "review",
  ok: reviewed.ok,
  pq: reviewed.pq,
  reason: reviewed.reason,
  sc: reviewed.sc,
  scorable: reviewed.scorable,
  selected,
});

const costSummary = (costs: readonly ApiCost[]) => ({
  calls: costs.reduce((sum, cost) => sum + cost.calls, 0),
  records: costs.map(({ calls, model, operation, source, usd }) => ({
    calls,
    model,
    operation,
    source,
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
  /** Stable Eve call id when invoked as a durable tool; random for direct HTTP calls. */
  readonly operationId?: string;
}

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
    }));
};

// oxlint-disable-next-line eslint/complexity -- one orchestration owns approval, proposal, tournament, and response assembly
export const generateStudioResponse = async (
  request: StudioRequest,
  options: GenerateStudioOptions = {},
): Promise<StudioResponse> => {
  const { finish, name, tags } = conceptOf(request);
  if (name === "icon" || (isVague(request.text) && !request.answers?.object)) {
    return {
      items: [...CLARIFY],
      kind: "questions",
      text: "A couple of questions before I start. I draw the object, not the intent.",
    };
  }

  const hasVisualRefs = request.attachments?.some(
    (file) => file.kind === "image" || file.kind === "svg",
  );
  if (hasVisualRefs && request.approved !== true && request.pending !== "approval") {
    return {
      approval: {
        body: "Iconsmith will reduce the first image to composition words — element count, coarse region, scale band, and adjacency — then discard its geometry. It will not trace the file or imitate another library's paths.",
        id: "reference",
        title: "Read the attachment as composition?",
      },
      kind: "approval",
      text: "The file can inform composition without becoming a path. I need your approval to read it.",
    };
  }
  if (hasVisualRefs && request.approved === false) {
    return {
      kind: "error",
      text: "Okay, leaving the attachment out. Send the object noun and I will draw from the house grammar.",
    };
  }

  const concept = { name, tags };
  const attachedProposal = hasVisualRefs ? await visualProposal(request) : null;
  const arsenal = await loadStudioArsenal(concept);
  const referenceSlots = referenceSet(arsenal.references, { concept: name, tags });
  const referenceImages = await Promise.all(
    referenceSlots.all.map((reference) => png(reference.svg, 96)),
  );

  let generatedProposal: Awaited<ReturnType<typeof propose>> | null = null;
  let proposalFailure: string | null = null;
  let proposal = attachedProposal;
  let proposalPromise: Promise<typeof proposal> | null = null;
  const ensureProposal = (): Promise<typeof proposal> => {
    if (proposal) {
      return Promise.resolve(proposal);
    }
    proposalPromise ??= (async () => {
      try {
        const run = await propose(concept, {
          corpus: arsenal.references,
          ideas: 2,
          parts: arsenal.parts,
          qualityModel: QUALITY_MODEL,
        });
        generatedProposal = run;
        ({ proposal } = run);
      } catch (error) {
        proposalFailure = error instanceof Error ? error.message : "Image proposal failed.";
      }
      return proposal;
    })();
    return proposalPromise;
  };
  const batchId = `${name}-${options.operationId ?? crypto.randomUUID()}`;
  const paints =
    finish === "filled" ? (["filled", "outlined"] as const) : (["outlined", "filled"] as const);
  const common = {
    corpus: arsenal.references,
    forceAgent: true,
    lookReferences: referenceImages,
    parts: arsenal.parts,
  } as const;
  const claude = harnessArm({
    ask: gatewayAsk,
    command: "claude",
    repairs: 2,
    spawn: gatewayHarnessSpawn(),
  });
  const ranking = await rankPairCandidates({
    candidates: libraryCandidates(concept, arsenal),
    concept,
  });
  const candidates: PairCandidate[] = [
    ...ranking.candidates,
    {
      generate: (paint) =>
        mixtureArm()(concept, {
          corpus: arsenal.references,
          finish: paint,
          parts: arsenal.parts,
        }),
      id: "host-mixture",
      label: "Host mixture baseline",
    },
    {
      generate: (paint) =>
        generateIcon(concept, {
          ...common,
          finish: paint,
          proposal: null,
          select: "slug",
        }),
      id: "gateway-agent",
      label: "Vercel Gateway tool agent",
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
          proposal: imageProposal,
          select: "contrast",
        });
      },
      id: "image-agent",
      label: "Image-guided Gateway agent",
      serial: true,
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
      serial: true,
    },
  ];
  const tournament = await runPairTournament({
    ask: gatewayAsk,
    candidates,
    concept,
    references: referenceImages,
    stopScore: CONFIDENT_PAIR_SCORE,
  });
  // The lazy closure is the only writer; TypeScript does not carry that
  // mutation across the awaited tournament call.
  const completedProposal = generatedProposal as Awaited<ReturnType<typeof propose>> | null;
  const proposalCosts = completedProposal?.costs ?? [];
  const runCosts = tournament.candidates.flatMap(candidateCosts);
  const rankingCosts = ranking.cost ? [ranking.cost] : [];
  const allCosts = [...rankingCosts, ...proposalCosts, ...runCosts];
  const measuredCost = costSummary(allCosts);
  const tournamentSummary = {
    candidates: tournament.candidates.map((candidate) => ({
      accepted: candidate.accepted,
      cost: costSummary(candidateCosts(candidate)),
      failure: candidate.failure?.slice(0, 1000) ?? null,
      id: candidate.id,
      label: candidate.label,
      paints: candidate.paints.map((paint) => ({
        accepted: paint.accepted,
        clean: paint.result.clean,
        findings: paint.audit.findings,
        finish: paint.finish,
        pq: paint.audit.pq,
        reason: paint.audit.reason,
        sc: paint.audit.sc,
        scorable: paint.audit.scorable,
        svg: paint.result.svg,
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
          reason: completedProposal.reason,
          references: completedProposal.references,
        }
      : null,
    proposalFailure,
    ranking: {
      order: ranking.order,
      reason: ranking.reason,
    },
    selected: tournament.winner?.id ?? tournament.best?.id ?? "none",
    strategy: {
      eligible: tournament.eligible,
      evaluated: tournament.candidates.length,
      stopScore: CONFIDENT_PAIR_SCORE,
      stoppedEarly: tournament.stoppedEarly,
    },
  };
  if (!tournament.winner) {
    const { best } = tournament;
    const quality = best
      ? ` The best pair was ${best.label} at ${best.score.toFixed(1)}/10.`
      : " Every candidate arm failed before it produced a pair.";
    return {
      kind: "error",
      text: `I rejected every candidate for “${name}” instead of returning another weak icon.${quality} Try a more specific object noun or attach a composition reference.`,
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
      finish: paint,
      id: `${batchId}-${paint}`,
      issues: asIssues(result.issues),
      name,
      program: result.program ?? "",
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
