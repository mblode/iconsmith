"use client";

import type { OverviewRow, OverviewSubject } from "@/lib/studio/overview";
import { safeStudioSvg } from "@iconsmith/contract/svg";

/**
 * The consistency lookup table.
 *
 * A row is a question about the whole population, not about one icon, so the
 * finding is the disagreement rather than any single drawing. The majority sets
 * the convention and the minority is what there is to look at.
 */

const Thumbnails = ({ subjects }: { subjects: readonly OverviewSubject[] }) => (
  <span className="flex flex-wrap gap-1">
    {subjects.map((subject) => {
      const svg = safeStudioSvg(subject.svg);
      return svg ? (
        <span
          className="size-6 shrink-0 text-foreground [&_svg]:size-6"
          // oxlint-disable-next-line react/no-danger -- house SVG, sanitised above
          dangerouslySetInnerHTML={{ __html: svg }}
          key={subject.id}
          title={subject.label}
        />
      ) : null;
    })}
  </span>
);

export const OverviewTable = ({ rows, total }: { rows: readonly OverviewRow[]; total: number }) => {
  const disagreements = rows.filter((row) => row.minority.length > 0).length;
  // Findings first, then rows that agree, then constructs nothing here uses.
  const ordered = rows.toSorted(
    (a, b) => b.minority.length - a.minority.length || Number(a.absent) - Number(b.absent),
  );

  if (total === 0) {
    return (
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-medium text-base">Nothing to compare yet</h2>
        <p className="max-w-[52ch] text-muted-foreground text-sm">
          Draw an icon. Every arm the tournament runs lands here, not just the pair that won, so the
          table has a population to audit rather than a single drawing.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-medium text-base">
          {total} drawings,{" "}
          {disagreements === 0
            ? "nothing in disagreement"
            : `${disagreements} ${disagreements === 1 ? "disagreement" : "disagreements"}`}
        </h2>
        <p className="max-w-[62ch] text-muted-foreground text-sm">
          Every candidate the tournament drew, not only the pair that shipped. The majority is the
          convention; the minority is the thing to look at.
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Consistency of {total} drawings across optical shape, repeated objects, dots, diagonals
          and solids
        </caption>
        <thead>
          <tr className="border-b text-left align-bottom">
            <th className="py-2 pr-4 font-medium" scope="col">
              Pattern
            </th>
            <th className="py-2 pr-4 font-medium" scope="col">
              Convention
            </th>
            <th className="py-2 font-medium" scope="col">
              Odd ones out
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr className="border-b align-baseline" key={row.id}>
              <th className="py-3 pr-4 font-medium" scope="row">
                <span className="block">{row.title}</span>
                <span className="block font-normal text-muted-foreground text-xs">
                  {row.question}
                </span>
              </th>
              <td className="py-3 pr-4">
                {row.absent ? (
                  <span className="text-muted-foreground">None of these use it</span>
                ) : (
                  <>
                    <span className="block">{row.convention ?? "No convention yet"}</span>
                    <span className="block text-muted-foreground text-xs">
                      {row.groups.map((group) => `${group.count}x ${group.value}`).join(" · ")}
                    </span>
                  </>
                )}
                {row.expected ? (
                  <span className="mt-1 block text-muted-foreground text-xs">
                    House: {row.expected}
                  </span>
                ) : null}
              </td>
              <td className="py-3">
                {row.minority.length > 0 ? (
                  <span className="flex flex-col gap-1">
                    <Thumbnails subjects={row.minority} />
                    <span className="text-muted-foreground text-xs">
                      {row.minority.map((subject) => subject.label).join(", ")}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">{row.absent ? "—" : "They agree"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
