/** Rasterize admitted source references under the candidate's viewing conditions. */
import { createHash } from "node:crypto";

import { opticalProof } from "../src/tools/proof.js";

interface ReferenceProof {
  manifest: Awaited<ReturnType<typeof opticalProof>>["metadata"] & {
    index: number;
    name: string;
    proofSha256: string;
    svgSha256: string;
  };
  proof: Buffer;
}

export const referenceProofName = (index: number) =>
  `reference-${index}-proof.png`;

export const referenceProofs = async (
  references: readonly string[],
  nativeSize: number,
  assertTime?: () => void
) => {
  const proofs: ReferenceProof[] = [];
  for (const [index, svg] of references.entries()) {
    assertTime?.();
    // Proofs are sequential so the shared deadline is checked per source.
    // eslint-disable-next-line no-await-in-loop
    const result = await opticalProof(svg, nativeSize);
    assertTime?.();
    proofs.push({
      manifest: {
        ...result.metadata,
        index,
        name: referenceProofName(index),
        proofSha256: createHash("sha256").update(result.proof).digest("hex"),
        svgSha256: createHash("sha256").update(svg).digest("hex"),
      },
      proof: result.proof,
    });
  }
  return proofs;
};
