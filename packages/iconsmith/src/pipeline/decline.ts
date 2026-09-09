/** An arm has no drawing for this concept; distinct from a runtime failure. */
export class ArmDeclinedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArmDeclinedError";
  }
}
