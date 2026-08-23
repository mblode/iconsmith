import { Client } from "eve/client";

const host = process.env.ICONSMITH_EVE_URL ?? "http://127.0.0.1:3210/iconsmith";
const client = new Client({ host });

await client.health();

const request = {
  attachments: [],
  finish: "outlined",
  text: process.env.ICONSMITH_SMOKE_CONCEPT ?? "home",
};
const { response } = await client.sessions.create({
  message: `STUDIO_REQUEST\n${JSON.stringify(request)}`,
});
const result = await response.result();
const toolEvent = result.events.findLast(
  (event) =>
    event.type === "action.result" &&
    event.data.result.kind === "tool-result" &&
    event.data.result.toolName === "generate_icon_pair",
);

if (
  !toolEvent ||
  toolEvent.type !== "action.result" ||
  toolEvent.data.result.kind !== "tool-result"
) {
  const eventSummary = result.events.map((event) => {
    if (event.type === "actions.requested") {
      return `${event.type}:${event.data.actions
        .map((action) => (action.kind === "tool-call" ? action.toolName : action.kind))
        .join(",")}`;
    }
    if (event.type === "action.result") {
      return `${event.type}:${event.data.result.kind}`;
    }
    if (event.type === "step.failed" || event.type === "turn.failed") {
      return `${event.type}:${event.data.code}:${event.data.message}`;
    }
    return event.type;
  });
  throw new Error(
    `Eve completed without a generate_icon_pair tool result. Events: ${eventSummary.join(" -> ")}`,
  );
}

const { output } = toolEvent.data.result;
if (typeof output !== "object" || output === null || !("kind" in output)) {
  throw new Error("The generate_icon_pair result was not a Studio response.");
}
if (output.kind !== "drawn" || !("versions" in output) || !Array.isArray(output.versions)) {
  if ("tournament" in output && output.tournament) {
    console.error(
      JSON.stringify(
        output.tournament.candidates.map((candidate) => ({
          accepted: candidate.accepted,
          failure: candidate.failure,
          id: candidate.id,
          paints: candidate.paints.map((paint) => ({
            accepted: paint.accepted,
            findings: paint.findings,
            finish: paint.finish,
            pq: paint.pq,
            reason: paint.reason,
            sc: paint.sc,
          })),
          score: candidate.score,
        })),
        null,
        2,
      ),
    );
  }
  throw new Error(`Expected a drawn Studio response, received ${JSON.stringify(output)}.`);
}
if (!("tournament" in output) || typeof output.tournament !== "object") {
  throw new Error("The Studio response did not include tournament evidence.");
}
if (!output.tournament.candidates.some((candidate) => candidate.accepted)) {
  throw new Error("No candidate pair cleared the tournament acceptance gate.");
}

const finishes = new Set(output.versions.map((version) => version.finish));
if (!finishes.has("outlined") || !finishes.has("filled")) {
  throw new Error("The Eve tool did not return both outlined and filled renders.");
}
if (
  output.versions.some(
    (version) =>
      typeof version.svg !== "string" ||
      !version.svg.includes("<svg") ||
      typeof version.agent !== "object" ||
      version.agent === null ||
      !("selected" in version.agent),
  )
) {
  throw new Error("A returned version is missing its render or visual-review agent record.");
}

console.log(
  JSON.stringify(
    {
      cost: output.tournament.cost,
      eventCount: result.events.length,
      finishes: [...finishes],
      proposalImages: output.tournament.proposal?.images ?? 0,
      selected: output.tournament.selected,
      sessionId: result.sessionId,
      status: result.status,
      strategy: output.tournament.strategy,
      tournament: output.tournament.candidates.map((candidate) => ({
        accepted: candidate.accepted,
        failure: candidate.failure,
        id: candidate.id,
        score: candidate.score,
      })),
      versions: output.versions.map((version) => ({
        agent: version.agent.selected,
        finish: version.finish,
        id: version.id,
      })),
    },
    null,
    2,
  ),
);
