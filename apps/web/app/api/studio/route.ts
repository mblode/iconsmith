import { audit, compose, describeProposal, EXPERT_IDS, gatewayAsk, mixtureArm } from "iconsmith";
import type { ExpertId } from "iconsmith";
import type { NextRequest } from "next/server";

import { clientIp, rateLimit } from "@/lib/request-guards";
import { conceptOf, isVague } from "@/lib/studio/concept";
import type {
  StudioAgentRun,
  StudioIssue,
  StudioRequest,
  StudioResponse,
  StudioVersion,
} from "@/lib/studio/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const CLARIFY = [
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
] as const;

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

const visualProposal = async (request: StudioRequest) => {
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
  const proposal = await compose(Buffer.from(payload, "base64"), { model: null });
  return proposal;
};

const selectedExpert = (trace: readonly string[], attempted: readonly ExpertId[]): ExpertId => {
  const head = trace[0] ?? "";
  return EXPERT_IDS.find((id) => head.endsWith(`/${id}`)) ?? attempted.at(-1) ?? "agent";
};

const agentRun = (
  selected: ExpertId,
  attempted: readonly ExpertId[],
  reviewed: Awaited<ReturnType<typeof audit>>,
): StudioAgentRun => ({
  attempted,
  findings: reviewed.findings,
  mode: selected === "agent" ? "draw-and-review" : "review",
  ok: reviewed.ok,
  pq: reviewed.pq,
  reason: reviewed.reason,
  sc: reviewed.sc,
  scorable: reviewed.scorable,
  selected,
});

const draw = async (request: StudioRequest): Promise<StudioResponse> => {
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
  const proposal = hasVisualRefs ? await visualProposal(request) : null;
  const batchId = `${name}-${crypto.randomUUID()}`;
  const paints =
    finish === "filled" ? (["filled", "outlined"] as const) : (["outlined", "filled"] as const);
  const drawn = await Promise.all(
    paints.map(async (paint) => {
      const attempted: ExpertId[] = [];
      const arm = mixtureArm({ onExpert: (id) => attempted.push(id) });
      const result = await arm(concept, { finish: paint, proposal });
      const selected = selectedExpert(result.trace, attempted);
      const reviewed =
        result.audit ??
        (await audit({
          ask: gatewayAsk,
          concept,
          finish: paint,
          kind: selected === "compile" || selected === "mark" ? selected : "analog",
          svg: result.svg,
        }));
      const version: StudioVersion = {
        agent: agentRun(selected, attempted, reviewed),
        batchId,
        brief: result.brief ?? `mixture ${name}`,
        clean: result.clean,
        finish: paint,
        id: `${batchId}-${paint}`,
        issues: asIssues(result.issues),
        name,
        program: result.program ?? "",
        steps: result.steps,
        svg: result.svg,
        trace: result.trace,
      };
      return version;
    }),
  );

  const unknown = drawn.some((row) => /\bunknown\b/iu.test(row.brief));
  const [lead] = drawn;
  const referenceNote = proposal
    ? ` Reference read: ${describeProposal(proposal).replaceAll("\n", " ").slice(0, 240)}`
    : "";
  const text = unknown
    ? `I do not have a house drawing for “${name}”, so the cheap arm returned an honest unknown — a frame and a dot, not the object. Chat the object noun (tray, fan, canopy) and I will try again.`
    : `${lead?.brief ?? name} — both paints. Chat to intervene, or attach a reference I will not trace.${referenceNote}`;

  return { kind: "drawn", text, versions: drawn };
};

export const POST = async (req: NextRequest): Promise<Response> => {
  const ip = await clientIp();
  if (!rateLimit(`studio:${ip}`, 40, Date.now())) {
    const body: StudioResponse = {
      kind: "error",
      text: "Too many draws from this address. Try again in an hour.",
    };
    return Response.json(body, { status: 429 });
  }

  let request: StudioRequest;
  try {
    request = (await req.json()) as StudioRequest;
  } catch {
    const body: StudioResponse = { kind: "error", text: "I could not read that message." };
    return Response.json(body, { status: 400 });
  }

  if (typeof request.text !== "string" || request.text.trim().length === 0) {
    const body: StudioResponse = { kind: "error", text: "Type the object you want drawn." };
    return Response.json(body, { status: 400 });
  }
  if (request.text.length > 2000) {
    const body: StudioResponse = { kind: "error", text: "Keep the brief under 2,000 characters." };
    return Response.json(body, { status: 400 });
  }

  try {
    return Response.json(await draw(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The drawer failed.";
    const body: StudioResponse = { kind: "error", text: message };
    return Response.json(body, { status: 500 });
  }
};
