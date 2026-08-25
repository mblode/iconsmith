"use client";

import Image from "next/image";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { safeStudioSvg } from "@iconsmith/contract/svg";
import type { StudioTournament, StudioVersion } from "@iconsmith/contract/types";

/** Every candidate is scored out of ten, so the plot lane is a fixed scale. */
const SCORE_MAX = 10;

const displayCost = (usd: number | null): string =>
  usd === null ? "cost incomplete" : `$${usd.toFixed(4)}`;

const candidateStatus = (candidate: StudioTournament["candidates"][number]): string => {
  if (candidate.failure) {
    return "Arm failed";
  }
  return candidate.accepted ? "Cleared the gate" : "Rejected";
};

const IconTile = ({ alt, size, svg }: { alt: string; size: number; svg: string }) => (
  <span className="flex aspect-square items-center justify-center border border-border text-foreground">
    <Image
      alt={alt}
      height={size}
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
      unoptimized
      width={size}
    />
  </span>
);

/**
 * Why the field was shorter than the field on offer.
 *
 * `unaffordable` and `haltedByFailure` were populated by the tournament,
 * carried all the way into the record, and read nowhere in this app. The card
 * printed "Evaluated N of M" and left the gap unexplained — and on the run that
 * matters most, a library recompile winning while both drawing arms were
 * refused for want of a reserve, `kind` is "drawn", so `generate.ts`'s "It
 * never ran X" sentence never fires either and nothing anywhere said two arms
 * had been refused.
 */
const StrategyNotes = ({ strategy }: { strategy: StudioTournament["strategy"] }) => {
  const refused = strategy.unaffordable;
  const { budget } = strategy;
  const reserved =
    budget === null
      ? ""
      : ` had $${budget.reservedUsd.toFixed(2)} of $${budget.maxUsd.toFixed(2)} already reserved and`;
  return (
    <>
      {refused.length > 0 ? (
        <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
          <span className="text-foreground">
            {refused.length === 1 ? "One arm never ran" : `${refused.length} arms never ran`}:{" "}
            {refused.join(", ")}.
          </span>{" "}
          The per-icon budget{reserved} could not reserve {refused.length === 1 ? "it" : "them"}, so{" "}
          {refused.length === 1 ? "it was" : "they were"} refused before drawing anything. A refused
          arm is not a beaten one — it never entered the field above.
        </p>
      ) : null}

      {/* Three shorts, three sentences. A tournament that halted because an arm
          threw is indistinguishable from one that ran out of money in
          `stoppedEarly`, and telling a reader to raise their budget is the
          wrong advice for a crash: a larger budget reproduces it at a larger
          price. */}
      {strategy.haltedByFailure ? (
        <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
          <span className="text-foreground">An arm failed, so the search stopped</span> rather than
          spend more after something broke. This is not a budget limit — a larger budget would
          reproduce it.
        </p>
      ) : null}
    </>
  );
};

export const ThinkingCard = ({
  tournament,
  versions,
}: {
  tournament?: StudioTournament;
  versions: readonly StudioVersion[];
}) => {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const [lead] = versions;

  if (!(lead || tournament)) {
    return null;
  }

  const stopScore = tournament?.strategy.stoppedEarly
    ? (tournament.strategy.stopScore ?? null)
    : null;
  /** The ceiling the run was actually held to. Always present on a live run —
   *  `generate.ts` reports the enforced ceiling rather than echoing back what
   *  the caller asked for — but nullable in the schema, so an archived record
   *  written before that still parses. */
  const budget = tournament?.strategy.budget ?? null;

  return (
    <section
      aria-label="Pipeline record"
      className="w-full max-w-xl rounded-xl border border-border p-4"
      data-slot="pipeline"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading font-medium text-sm">How this was drawn</h3>
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open ? (
        <div className="mt-5 flex flex-col gap-8" id={panelId}>
          {tournament ? (
            <section>
              <h4 className="font-heading font-medium text-sm">
                {tournament.candidates.length} arms drew the pair, one was kept
              </h4>
              <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                Both paints must clear SC {tournament.minimum.sc}/10 and PQ {tournament.minimum.pq}
                /10, lint, and zero visual findings. Evaluated {
                  tournament.strategy.evaluated
                } of{" "}
                {tournament.strategy.eligible} pairs across {tournament.cost.calls} billed calls,{" "}
                {displayCost(tournament.cost.totalUsd)}
                {budget ? ` of a $${budget.maxUsd.toFixed(2)} per-icon ceiling` : ""}.
              </p>

              {/* One grid owns every lane, so each track starts and ends on the
                  same line and only the fill length varies with the score. */}
              <ol className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3">
                {tournament.candidates.map((candidate) => {
                  const selected = candidate.id === tournament.selected;
                  const scored = !candidate.failure;
                  return (
                    <li
                      className="col-span-3 grid grid-cols-subgrid items-center"
                      key={candidate.id}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={`truncate text-xs ${selected ? "font-medium" : "text-muted-foreground"}`}
                        >
                          {candidate.label}
                          {selected ? " (kept)" : ""}
                        </span>
                        <span className="truncate text-muted-foreground text-xs">
                          {candidateStatus(candidate)} · {candidate.cost.calls} calls
                        </span>
                      </span>

                      <span className="relative block h-1.5 w-full bg-border">
                        {scored ? (
                          <span
                            className={
                              selected
                                ? "block h-full bg-foreground"
                                : "block h-full bg-muted-foreground"
                            }
                            style={{
                              width: `${Math.max(0, Math.min(1, candidate.score / SCORE_MAX)) * 100}%`,
                            }}
                          />
                        ) : null}
                        {stopScore === null ? null : (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-[-3px] w-px bg-foreground/45"
                            style={{ left: `${(stopScore / SCORE_MAX) * 100}%` }}
                          />
                        )}
                      </span>

                      <span className="tabular-figures text-right text-xs">
                        {scored ? `${candidate.score.toFixed(1)}` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
                Score out of {SCORE_MAX}, same scale for every arm.
                {stopScore === null
                  ? ""
                  : ` The rule marks ${stopScore.toFixed(2)}, the confidence score that stopped the search early.`}{" "}
                A failed arm produced no pair, so it has no score to plot.
              </p>

              {tournament.candidates.some((candidate) => candidate.paints.length > 0) ? (
                <ul className="mt-5 flex flex-wrap gap-4">
                  {tournament.candidates
                    .filter((candidate) => candidate.paints.length > 0)
                    .map((candidate) => (
                      <li className="flex flex-col gap-1.5" key={`paints-${candidate.id}`}>
                        <span className="flex gap-1.5">
                          {candidate.paints.map((paint) => (
                            <IconTile
                              alt={`${candidate.label}, ${paint.finish}`}
                              key={paint.finish}
                              size={40}
                              svg={safeStudioSvg(paint.svg)}
                            />
                          ))}
                        </span>
                        <span
                          className={`text-xs ${candidate.id === tournament.selected ? "font-medium" : "text-muted-foreground"}`}
                        >
                          {candidate.label}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : null}

              {tournament.ranking?.reason ? (
                <p className="mt-4 text-muted-foreground text-xs leading-relaxed">
                  Ranked {tournament.ranking.order[0] ?? "no library pair"} first.{" "}
                  {tournament.ranking.reason}
                </p>
              ) : null}

              {tournament.proposal ? (
                <p className="mt-2 text-muted-foreground text-xs leading-relaxed">
                  Composition came from sketch {tournament.proposal.chosen + 1} of{" "}
                  {tournament.proposal.images}, sampled from {tournament.proposal.references.length}{" "}
                  licensed house icons across {tournament.proposal.models.length} image-model calls,{" "}
                  {displayCost(tournament.proposal.cost.totalUsd)}.
                  {tournament.proposal.reason ? ` ${tournament.proposal.reason}` : ""}
                </p>
              ) : null}
              {tournament.proposalFailure ? (
                <p className="mt-2 text-xs leading-relaxed">
                  No image composition was available: {tournament.proposalFailure}
                </p>
              ) : null}

              {tournament.candidates
                .filter((candidate) => candidate.failure)
                .map((candidate) => (
                  <p
                    className="mt-2 text-muted-foreground text-xs leading-relaxed"
                    key={`failure-${candidate.id}`}
                  >
                    <span className="text-foreground">{candidate.label} failed.</span>{" "}
                    {candidate.failure}
                  </p>
                ))}

              <StrategyNotes strategy={tournament.strategy} />
            </section>
          ) : null}

          {versions.map((version) => (
            <section
              className="border-border border-t pt-6 first:border-t-0 first:pt-0"
              key={version.id}
            >
              <div className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
                <IconTile
                  alt={`${version.name}, ${version.finish}`}
                  size={72}
                  svg={safeStudioSvg(version.svg)}
                />
                <div className="flex min-w-0 flex-col gap-2">
                  <div>
                    <h4 className="font-heading font-medium text-sm capitalize">
                      {version.finish} render
                    </h4>
                    <p className="text-muted-foreground text-xs">
                      {version.agent.mode === "draw-and-review"
                        ? "Drawn and reviewed by the agent"
                        : `Drawn by ${version.agent.selected}, independently reviewed`}
                      {version.clean ? ", lint clean" : ", flagged for review"}
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed">{version.brief}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Tried {version.agent.attempted.join(", then ")}, selected{" "}
                    {version.agent.selected}.{" "}
                    {version.agent.scorable
                      ? `Visual review scored SC ${version.agent.sc}/10 and PQ ${version.agent.pq}/10.`
                      : "The visual review could not be scored, so the drawing was preserved as-is."}
                  </p>
                  {version.agent.reason ? (
                    <p className="text-xs leading-relaxed">{version.agent.reason}</p>
                  ) : null}
                </div>
              </div>

              {version.agent.findings.length > 0 || version.issues.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-1.5 text-xs leading-relaxed">
                  {version.agent.findings.map((finding) => (
                    <li key={`${finding.kind}-${finding.message}`}>
                      <span className="text-muted-foreground">Review, {finding.kind}:</span>{" "}
                      {finding.message}
                    </li>
                  ))}
                  {version.issues.map((issue) => (
                    <li key={`${issue.rule}-${issue.message}`}>
                      <span className="text-muted-foreground">
                        Lint {issue.severity}, <span className="font-mono">{issue.rule}</span>:
                      </span>{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-muted-foreground text-xs">No lint or review findings.</p>
              )}

              <h5 className="mt-5 font-medium text-xs">Recorded steps</h5>
              <ol className="mt-1.5 grid gap-1 font-mono text-muted-foreground text-xs sm:grid-cols-2">
                {version.trace.map((step, index) => (
                  <li key={`${step}-${index}`}>
                    {index + 1}. {step}
                  </li>
                ))}
              </ol>

              <h5 className="mt-5 font-medium text-xs">Program</h5>
              <pre className="mt-1.5 overflow-x-auto bg-code p-3 font-mono text-code-foreground text-xs leading-relaxed">
                <code>{version.program}</code>
              </pre>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
};
