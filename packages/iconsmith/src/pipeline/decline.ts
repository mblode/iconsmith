/**
 * An arm saying "not me", as distinct from an arm falling over.
 *
 * The tournament stops escalating when an arm throws, and that is right for a
 * crash: spending more after something broke is rarely what the caller wants.
 * It is wrong for an arm that simply has no answer. Both were the same throw,
 * and the difference cost a whole tournament — when `host-analog` began
 * refusing concepts it had no analog for (rather than drawing a frame with a
 * dot in it and calling that an icon), `webhooks` halted at arm 1 of 4 and the
 * three arms that could actually have drawn it never ran.
 *
 * So a decline is recorded like any other failed arm — it is visible, it names
 * its reason, and its pair is incomplete — and the field carries on without it.
 *
 * Lives in its own module rather than beside either party, because
 * `pipeline/generate.ts` already imports `analog.js`; importing a value back
 * the other way would close a runtime cycle.
 */
export class ArmDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArmDeclinedError";
  }
}

/** True for a decline, whatever realm the error crossed to get here. */
export const isDeclined = (error: unknown): boolean =>
  error instanceof ArmDeclinedError ||
  (error instanceof Error && error.name === "ArmDeclinedError");
