import type { Canvas } from "../tools/canvas.js";
import type { Finish } from "../types.js";

export interface SourceExactResolver {
  readonly icon: string;
  readonly registryHash: string;
  place: (bindingId: string, canvas: Canvas, finish: Finish) => void;
}

const issuedResolvers = new WeakSet<object>();

/** Marks an admission-created resolver as process-local authority. Recreating
 * its serial fields does not recreate the capability consumed by the DSL. */
export const issueSourceExactResolver = <Resolver extends SourceExactResolver>(
  resolver: Resolver
): Readonly<Resolver> => {
  if (!resolver.icon || !/^[a-f0-9]{64}$/u.test(resolver.registryHash)) {
    throw new Error("Source-exact resolver identity is malformed");
  }
  const issued = Object.freeze(resolver);
  issuedResolvers.add(issued);
  return issued;
};

export const isIssuedSourceExactResolver = (
  resolver: SourceExactResolver | undefined
): resolver is SourceExactResolver =>
  resolver !== undefined && issuedResolvers.has(resolver);
