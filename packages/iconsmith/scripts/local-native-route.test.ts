import path from "node:path";

import { expect, it } from "vitest";

import type { NativeCallContainerFactory } from "./local-native-call-factory.js";
import {
  assertCanonicalNativeStyleRoute,
  createNativeStyleRoute,
  createNativeStyleRouteForTest,
} from "./local-native-route.js";
import type {
  NativeStyleAuthorConfig,
  NativeStyleRoute,
  NativeStyleReviewerConfig,
} from "./local-native-route.js";
import { freezeProductionNativeRequestBudget } from "./review-budget.js";

const factory = {} as NativeCallContainerFactory;
const author = {
  container: {},
  containerFactory: factory,
  id: "astra-author",
  lineage: "astra",
  provider: "openai-astra",
} as NativeStyleAuthorConfig;
const reviewer = (id: string, lineage: string, model: string) =>
  ({
    containerFactory: factory,
    id,
    lineage,
    model,
    provider: "openai-codex",
  }) as NativeStyleReviewerConfig;

it("constructs only the frozen two-lineage route", () => {
  const now = Date.now();
  const route = createNativeStyleRoute({
    author,
    budget: freezeProductionNativeRequestBudget({
      deadlineAt: now + 1_200_000,
      now,
      startedAt: now,
    }),
    reviewers: [
      reviewer("codex-five", "gpt-5-5", "gpt-5.5"),
      reviewer("codex-six", "gpt-6-review", "gpt-6-astra"),
    ],
    runtimeRoot: path.resolve("/tmp/iconsmith-native-route-test"),
  });
  expect(() => assertCanonicalNativeStyleRoute(route)).not.toThrow();
  expect(route.budget).toMatchObject({ maxCalls: 10, reviewRounds: 1 });
  expect(Object.isFrozen(route)).toBe(true);
});

it.each([
  ["author-lineage", "astra", "gpt-5-5", "gpt-5.5"],
  ["duplicate-lineage", "gpt-5-5", "gpt-5-5", "gpt-6-astra"],
  ["duplicate-model", "gpt-5-5", "gpt-6-review", "gpt-5.5"],
])(
  "rejects %s reviewer identity before dispatch",
  (_case, secondLineage, thirdLineage, thirdModel) => {
    const now = Date.now();
    expect(() =>
      createNativeStyleRoute({
        author,
        budget: freezeProductionNativeRequestBudget({
          deadlineAt: now + 1_200_000,
          now,
          startedAt: now,
        }),
        reviewers: [
          reviewer("reviewer-one", secondLineage, "gpt-5.5"),
          reviewer("reviewer-two", thirdLineage, thirdModel),
        ],
        runtimeRoot: path.resolve("/tmp/iconsmith-native-route-test"),
      })
    ).toThrow(/independent reviewer lineages/u);
  }
);

it("does not accept an arbitrary object as a canonical route", () => {
  const arbitrary = {
    author: {
      id: "author",
      lineage: "author",
      run: () => Promise.reject(new Error("unused test route")),
    },
    reviewers: [],
    runtimeRoot: "/tmp/runtime",
  } as unknown as NativeStyleRoute;
  expect(() => assertCanonicalNativeStyleRoute(arbitrary)).toThrow(
    /canonical constructor/u
  );
  expect(() => createNativeStyleRouteForTest(arbitrary)).toThrow(
    /independent reviewers/u
  );
});
