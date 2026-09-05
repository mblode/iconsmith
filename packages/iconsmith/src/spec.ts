/**
 * The static house specification, as a narrow server-safe entrypoint.
 *
 * Importing `SPEC` through the package root also loads the CLI, corpus, and
 * harness export graph. A page that only needs keyline names should not make a
 * deployment tracer inspect filesystem code it can never call.
 */
export { SPEC } from "./tools/spec.js";
