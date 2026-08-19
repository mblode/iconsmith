import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { IconScore } from "../src/pipeline/eval.js";
import { DEFAULT_POLICY } from "../src/pipeline/policy.js";
import {
  acquireLock,
  advanceRef,
  championFromBranch,
  dirtyPaths,
  frozenDrift,
  judge,
  parseProgram,
  ratchet,
  readProgram,
  wilcoxon,
} from "./loop.js";

const ok = (icon: string, score: number, clean = true): IconScore =>
  ({
    clean,
    floor: 0,
    icon,
    issues: 0,
    ms: 1,
    score,
    status: "ok",
    steps: 1,
    stopReason: "clean",
    tags: [],
    toolCalls: {},
    usage: null,
    usd: null,
  }) as unknown as IconScore;

const arm = (scores: number[], clean = true) =>
  scores.map((s, i) => ok(`i${i}`, s, clean));

/**
 * These pin the rule that decides whether a change to the generator is kept.
 * Every one of them encodes a way a loop talks itself into a win: a gain too
 * small for the metric to resolve, a gain that is not distinguishable from
 * noise, and a gain bought by drawing worse.
 */
describe("the acceptance rule", () => {
  const FLOOR = 0.03;

  it("rejects a gain under the noise floor, however consistent", () => {
    const before = arm([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const after = arm([0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/noise floor/u);
  });

  it("rejects a large median that is not significant", () => {
    const before = arm([0.5, 0.5, 0.5]);
    const after = arm([0.9, 0.9, 0.9]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/signed-rank/u);
  });

  it("rejects a real gain bought by a fall in lint-clean rate", () => {
    const before = arm([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], true);
    const after = arm([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], false);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/lint-clean/u);
  });

  it("accepts a gain that is large, consistent and clean", () => {
    const before = arm([0.4, 0.45, 0.5, 0.55, 0.6, 0.42, 0.48, 0.52]);
    const after = arm([0.5, 0.55, 0.6, 0.65, 0.7, 0.52, 0.58, 0.62]);
    const v = judge(before, after, FLOOR);
    expect(v.accepted).toBe(true);
    expect(v.medianDelta).toBeCloseTo(0.1, 5);
  });

  it("calls a lost generation a crash, not a bad score", () => {
    const before = arm([0.4, 0.45, 0.5, 0.55, 0.6, 0.42, 0.48, 0.52]);
    const after = arm([0.5, 0.55, 0.6, 0.65, 0.7, 0.52, 0.58, 0.62]);
    const v = judge(before, after, FLOOR, { champion: 0, variant: 2 });
    expect(v.status).toBe("crash");
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/did not both run/u);
  });

  it("does not let a crash borrow the win it would otherwise have had", () => {
    const before = arm([0.4, 0.45, 0.5, 0.55, 0.6, 0.42, 0.48, 0.52]);
    const after = arm([0.5, 0.55, 0.6, 0.65, 0.7, 0.52, 0.58, 0.62]);
    expect(judge(before, after, FLOOR).status).toBe("keep");
    expect(
      judge(before, after, FLOOR, { champion: 1, variant: 0 }).status
    ).toBe("crash");
  });

  it("reports no pairs rather than inventing a verdict", () => {
    const v = judge(arm([0.5]), [ok("other", 0.9)], FLOOR);
    expect(v.accepted).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/no paired icons/u);
  });
});

describe("wilcoxon", () => {
  it("refuses to call significance on a sample too small to have any", () => {
    expect(wilcoxon([0.1, 0.1, 0.1]).p).toBe(1);
  });

  it("drops ties rather than counting them as evidence", () => {
    expect(wilcoxon([0, 0, 0, 0.1]).n).toBe(1);
  });
});

/**
 * The ratchet, against a throwaway repository.
 *
 * These are the tests that matter for the Darwin Godel Machine failure: that
 * machine deleted the markers its researchers used to detect it cheating. So
 * the question here is never "did the good commit land" alone, it is "could
 * anything but the policy have landed", and the assertions check the paths the
 * commit did *not* touch as hard as the one it did.
 */
// Every assertion here spawns several git processes, which is slower than the
// default per-test budget on a loaded machine.
const GIT = { timeout: 60_000 };

const gitIn = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

describe("the ratchet", GIT, () => {
  const POLICY = "packages/iconsmith/src/pipeline/policy.default.json";
  const BRANCH = "iconsmith/loop";
  let repo: string;

  const run = (args: string[]): string => gitIn(repo, args);

  const write = (rel: string, body: string): void => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), body);
  };

  const FROZEN = [
    "packages/iconsmith/program.md",
    "packages/iconsmith/scripts/gate.ts",
  ];

  const commitPolicy = (body: string, message = "loop: keep a") =>
    ratchet({
      branch: BRANCH,
      cwd: repo,
      frozen: FROZEN,
      message,
      policyJson: body,
      policyPath: POLICY,
    });

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "loop-ratchet-"));
    run(["init", "--initial-branch=main"]);
    run(["config", "user.email", "loop@test"]);
    run(["config", "user.name", "loop"]);
    write(POLICY, '{"v":0}\n');
    write("packages/iconsmith/program.md", "# program\n");
    write("packages/iconsmith/scripts/gate.ts", "// the gate\n");
    run(["add", "-A"]);
    run(["commit", "-m", "base"]);
  }, GIT.timeout);

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  it("commits the winning policy to the experiment branch and nothing else", () => {
    const head = run(["rev-parse", "HEAD"]);
    const { parent, sha } = commitPolicy('{"v":1}\n');

    expect(parent).toBe(head);
    expect(run(["rev-parse", `refs/heads/${BRANCH}`])).toBe(sha);
    expect(
      run(["diff-tree", "-r", "--name-only", "--no-commit-id", head, sha])
    ).toBe(POLICY);
    expect(run(["show", `${sha}:${POLICY}`])).toBe('{"v":1}');
    // The markers are still exactly the markers.
    expect(run(["show", `${sha}:packages/iconsmith/program.md`])).toBe(
      "# program"
    );
    expect(run(["show", `${sha}:packages/iconsmith/scripts/gate.ts`])).toBe(
      "// the gate"
    );
  });

  it("leaves the checked-out branch where it was", () => {
    const head = run(["rev-parse", "HEAD"]);
    commitPolicy('{"v":1}\n');
    expect(run(["rev-parse", "HEAD"])).toBe(head);
    expect(run(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(readFileSync(path.join(repo, POLICY), "utf-8")).toBe('{"v":0}\n');
  });

  it("carries the scorecard into the commit message", () => {
    const { sha } = commitPolicy('{"v":1}\n', "loop: keep x\n\nmedian 0.0400");
    expect(run(["log", "-1", "--format=%B", sha])).toContain("median 0.0400");
  });

  it("stacks a second keep on the first, so the tip is the champion", () => {
    const first = commitPolicy('{"v":1}\n');
    const second = commitPolicy('{"v":2}\n');
    expect(second.parent).toBe(first.sha);
    // base + two kept iterations: the history is the record of what survived.
    expect(run(["rev-list", "--count", second.sha])).toBe("3");
  });

  it("reads the champion back from the branch tip", () => {
    expect(championFromBranch(repo, BRANCH, POLICY)).toBeNull();
    const policy = JSON.stringify(DEFAULT_POLICY);
    commitPolicy(policy);
    expect(championFromBranch(repo, BRANCH, POLICY)).toEqual(DEFAULT_POLICY);
  });

  it("refuses over an uncommitted edit rather than recording a win against source that is in no commit", () => {
    writeFileSync(
      path.join(repo, "packages/iconsmith/scripts/gate.ts"),
      "// edited\n"
    );
    expect(() => commitPolicy('{"v":1}\n')).toThrow(/uncommitted changes/u);
    // Named in full: a refusal that mangles the path is a refusal nobody acts on.
    expect(dirtyPaths(repo, [])).toEqual([
      "packages/iconsmith/scripts/gate.ts",
    ]);
    expect(dirtyPaths(repo, ["packages/iconsmith/scripts/gate.ts"])).toEqual(
      []
    );
    expect(() => run(["rev-parse", `refs/heads/${BRANCH}`])).toThrow();
  });

  it("refuses a commit that would touch anything but the policy", () => {
    expect(() =>
      ratchet({
        branch: BRANCH,
        cwd: repo,
        frozen: FROZEN,
        message: "loop: keep a",
        policyJson: "frozen no more\n",
        policyPath: "packages/iconsmith/program.md",
      })
    ).toThrow(/freezes packages\/iconsmith\/program\.md/u);
  });

  it("refuses a policy identical to the champion rather than logging a no-op keep", () => {
    commitPolicy('{"v":1}\n');
    expect(() => commitPolicy('{"v":1}\n')).toThrow(/byte-identical/u);
  });

  it("refuses to advance a branch that moved under the run", () => {
    const stale = run(["rev-parse", "HEAD"]);
    const first = commitPolicy('{"v":1}\n');
    // A second run that started before `first` landed still holds `stale`.
    expect(() => advanceRef(repo, BRANCH, first.sha, stale)).toThrow(
      /moved while this iteration was running/u
    );
    expect(run(["rev-parse", `refs/heads/${BRANCH}`])).toBe(first.sha);
  });

  it("sees a frozen path that drifted on the experiment branch", () => {
    commitPolicy('{"v":1}\n');
    run(["checkout", "-q", BRANCH]);
    writeFileSync(
      path.join(repo, "packages/iconsmith/scripts/gate.ts"),
      "// weakened\n"
    );
    run(["commit", "-qam", "loosen the gate"]);
    run(["checkout", "-q", "main"]);

    const frozen = ["packages/iconsmith/scripts/gate.ts"];
    expect(frozenDrift(repo, BRANCH, "HEAD", frozen)).toEqual(frozen);
    expect(frozenDrift(repo, BRANCH, "HEAD", [POLICY])).toEqual([POLICY]);
    expect(frozenDrift(repo, "no-such-branch", "HEAD", frozen)).toEqual([]);
  });

  it("lets one run hold the lock at a time", () => {
    const lock = path.join(repo, "loop.lock");
    const release = acquireLock(lock, BRANCH);
    expect(() => acquireLock(lock, BRANCH)).toThrow(/another loop run/u);
    release();
    acquireLock(lock, BRANCH)();
  });
});

describe("program.md", () => {
  it("reads the frozen list the human wrote, comments and blanks dropped", () => {
    expect(
      parseProgram(
        "prose\n\n```frozen\nsrc/tools/render.ts\n\n# why\nbench/x.json # inline\n```\nmore prose\n"
      )
    ).toEqual(["src/tools/render.ts", "bench/x.json"]);
  });

  it("finds no frozen paths in a file that declares none", () => {
    expect(parseProgram("# program\n\njust prose\n")).toEqual([]);
  });

  it("freezes what the shipped program.md says it freezes", () => {
    const program = readProgram(
      path.join(import.meta.dirname, "..", "program.md")
    );
    expect(program.frozen).toContain("packages/iconsmith/src/tools/render.ts");
    expect(program.frozen).toContain("packages/iconsmith/program.md");
    expect(program.frozen).not.toContain(
      "packages/iconsmith/src/pipeline/policy.default.json"
    );
    expect(program.sha).toMatch(/^[0-9a-f]{12}$/u);
  });
});
