/** Rasterize admitted source references under the candidate's viewing conditions. */
import { createHash } from "node:crypto";

import { opticalProof } from "../src/tools/proof.js";

export const referenceProofName = (index: number) =>
  `reference-${index}-proof.png`;

export const referenceProofs = (
  references: readonly string[],
  nativeSize: number
) =>
  Promise.all(
    references.map(async (svg, index) => {
      const result = await opticalProof(svg, nativeSize);
      return {
        manifest: {
          ...result.metadata,
          index,
          name: referenceProofName(index),
          proofSha256: createHash("sha256").update(result.proof).digest("hex"),
          svgSha256: createHash("sha256").update(svg).digest("hex"),
        },
        proof: result.proof,
      };
    })
  );
