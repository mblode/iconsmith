import type { AcceptanceCampaignTerminalExpectation } from "../src/eval/acceptance-contract.js";
import { withComputedCampaignTerminalEvidence } from "../src/eval/acceptance-contract.js";
import type { CampaignTerminalEvidenceCapability } from "./local-campaign.js";
import { readCampaignTerminalEvidence } from "./local-campaign.js";

export interface BoundCampaignTerminalEvidence {
  capability: CampaignTerminalEvidenceCapability;
  expected: AcceptanceCampaignTerminalExpectation;
}

/** Revalidates the retained terminal bytes behind every process-local campaign
 * capability and keeps the resulting acceptance authority inside one stack
 * frame. Caller-frozen expectations identify the intended campaign; they are
 * comparisons, never authority by themselves. */
export const withCampaignTerminalEvidence = <T>(
  bindings: readonly BoundCampaignTerminalEvidence[],
  consume: Parameters<typeof withComputedCampaignTerminalEvidence<T>>[2]
): T =>
  withComputedCampaignTerminalEvidence(
    bindings.map(({ expected }) => expected),
    () =>
      bindings.map(({ capability }) =>
        readCampaignTerminalEvidence(capability)
      ),
    consume
  );
