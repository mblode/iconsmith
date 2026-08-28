import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isResumable, loadCampaign } from "./campaign.ts";
import type { CampaignItem } from "./campaign.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const sessionId = (mintedAt: number): string => {
  let time = "";
  let remaining = mintedAt;
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }
  return `wrun_${time}0123456789ABCDEF`;
};

const item = (overrides: Partial<CampaignItem>): CampaignItem => ({
  attemptCount: 1,
  id: "1",
  lastSessionId: sessionId(Date.now()),
  rank: 1,
  risky: false,
  slug: "alarm-smoke",
  sources: [],
  status: "exploring",
  ...overrides,
});

describe("isResumable", () => {
  it("resumes a concept whose recorded session can still take a turn", () => {
    assert.equal(isResumable(item({})), true);
  });

  it("refuses a concept the workbench never drew", () => {
    assert.equal(isResumable(item({ attemptCount: 0 })), false);
    assert.equal(isResumable(item({ lastSessionId: null })), false);
  });

  it("refuses a recorded session that has aged out", () => {
    // The bug this guards: a drawn concept was offered as resumable on the
    // strength of attemptCount alone, so the studio opened it with a cursor the
    // server refuses and showed an empty transcript under a heading promising a
    // tournament.
    const twoDays = Date.now() - 2 * 24 * 60 * 60 * 1000;
    assert.equal(isResumable(item({ lastSessionId: sessionId(twoDays) })), false);
  });

  it("finds nothing resumable in the committed campaign, which is the honest answer", () => {
    /**
     * Not a wish, a property of the file: `campaign.json` is generated and
     * committed, so every id in it was minted before the deploy that ships it
     * and ages with the git history. If this ever fails, the ids became live —
     * which means the campaign is being regenerated per deploy, and this test
     * is the right place to find that out.
     */
    assert.equal(loadCampaign().filter(isResumable).length, 0);
  });
});
