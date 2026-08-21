import { mass, program, vbar } from "../tools/twin.js";
/**
 * One host repair after a look. Not an agent, not a coordinate.
 *
 * The catalog is closed and smaller than five verbs. Each verb rewrites DSL
 * through `twin.ts`. Findings that name a house motif have no verb.
 */
import type { Finish } from "../types.js";
import type { AuditFinding } from "./audit.js";
import type { MarkName } from "./marks.js";

export type RepairName = "gap-tiles" | "square-joint";

const mentions = (findings: readonly AuditFinding[], re: RegExp): boolean =>
  findings.some((f) => re.test(f.message) || re.test(f.kind));

/** Pick at most one verb. Order is the argument: tiles before joints. */
export const pickRepair = (
  mark: MarkName,
  _finish: Finish,
  findings: readonly AuditFinding[]
): RepairName | null => {
  if (findings.length === 0) {
    return null;
  }
  if (
    mark === "view-grid" &&
    findings.some((f) => f.kind === "gap" || f.kind === "finish")
  ) {
    return "gap-tiles";
  }
  if (mark === "flag" && mentions(findings, /join|pole|corner|notch/u)) {
    return "square-joint";
  }
  return null;
};

export const applyRepair = (
  mark: MarkName,
  slug: string,
  finish: Finish,
  repair: RepairName
): string | null => {
  if (repair === "gap-tiles" && mark === "view-grid") {
    // 5×5 with a 4-unit gutter so filled `mass` still leaves a 2-unit gap.
    return program(slug, finish, "square", [
      mass(finish, 4, 4, 6, 6, 2),
      mass(finish, 14, 4, 6, 6, 2),
      mass(finish, 4, 14, 6, 6, 2),
      mass(finish, 14, 14, 6, 6, 2),
    ]);
  }
  if (repair === "square-joint" && mark === "flag") {
    return program(slug, finish, null, [
      vbar(finish, 6, 4, 16),
      finish === "filled" ? "rect 7,6 12x10 r0" : "rect 7,6 11x8 r0",
    ]);
  }
  return null;
};
