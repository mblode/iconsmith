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

import {
  AutoresearchError,
  decide,
  dirtyPaths,
  findCloudAgentLauncher,
  HOLD_OUT_UNKNOWN,
  isEditablePath,
  isFrozenPath,
  parseStanding,
  pathMatches,
  readStanding,
  renderCloudBrief,
  runCampaign,
} from "./autoresearch.js";
import type { Scoreboard } from "./autoresearch.js";

const STANDING = path.join(import.meta.dirname, "..", "autoresearch.md");

const board = (over: Partial<Scoreboard> = {}): Scoreboard => ({
  correctAndClean: 10,
  gapErrors: 0,
  holdoutsUnknown: true,
  recipeClean: true,
  recipeHoles: 0,
  testsOk: true,
  twinEval: { skipped: "house files not given" },
  twinPairErrors: 0,
  typecheckOk: true,
  ...over,
});

const GIT = { timeout: 60_000 };

const gitIn = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

describe("autoresearch.md", () => {
  it("refuses to start without the standing file", () => {
    expect(() =>
      readStanding(path.join(tmpdir(), "no-such-autoresearch.md"))
    ).toThrow(/No autoresearch\.md/u);
  });

  it("freezes itself and names the hold-outs the scoreboard must keep unknown", () => {
    const standing = readStanding(STANDING);
    expect(standing.frozen).toContain("packages/iconsmith/autoresearch.md");
    expect(standing.frozen).toContain("packages/iconsmith/program.md");
    expect(standing.frozen).toContain("packages/iconsmith/scripts/loop.ts");
    expect(standing.editable).toContain("packages/iconsmith/src/pipeline/**");
    expect(standing.editable).toContain("packages/iconsmith/src/tools/**");
    expect(standing.editable).toContain("packages/iconsmith/src/commands/**");
    expect(standing.editable).toContain("packages/iconsmith/SKILL.md");
    expect(
      isEditablePath("packages/iconsmith/src/pipeline/analog.ts", standing)
    ).toBe(true);
    expect(
      isEditablePath("packages/iconsmith/src/pipeline/recipe.ts", standing)
    ).toBe(true);
    expect(
      isEditablePath("packages/iconsmith/src/pipeline/prompt.ts", standing)
    ).toBe(true);
    expect(
      isFrozenPath("packages/iconsmith/src/tools/render.ts", standing)
    ).toBe(true);
    expect(
      isEditablePath("packages/iconsmith/src/tools/render.ts", standing)
    ).toBe(false);
    expect(isFrozenPath("packages/iconsmith/scripts/loop.ts", standing)).toBe(
      true
    );
    expect(isFrozenPath("package.json", standing)).toBe(true);
    expect(standing.frozen).toContain("packages/iconsmith/scripts/research.ts");
    expect(standing.frozen).toContain(
      "packages/iconsmith/scripts/cloud-round.md"
    );
    expect(standing.holdout).toEqual([...HOLD_OUT_UNKNOWN]);
    for (const name of ["star", "compass", "quokka", "xyzzy"] as const) {
      expect(standing.holdout).toContain(name);
    }
    expect(standing.playbook.map((item) => item.id)).toContain("home-family");
  });
});

describe("the keep rule", () => {
  it("keeps only when a floor holds and an advance number improves", () => {
    expect(decide(board(), board({ correctAndClean: 11 })).status).toBe("keep");
    expect(decide(board(), board({ recipeHoles: 0 })).status).toBe("discard");
    expect(
      decide(board({ recipeHoles: 1 }), board({ recipeHoles: 0 })).status
    ).toBe("keep");
  });

  it("calls tests red a crash, not a discard", () => {
    const v = decide(board(), board({ correctAndClean: 99, testsOk: false }));
    expect(v.status).toBe("crash");
    expect(v.reasons.join(" ")).toMatch(/tests red/u);
  });

  it("discards drawing a hold-out that must stay unknown", () => {
    const v = decide(board(), board({ holdoutsUnknown: false }));
    expect(v.status).toBe("discard");
    expect(v.reasons.join(" ")).toMatch(/hold-out/u);
  });
});

describe("the ratchet", GIT, () => {
  const ANALOG = "packages/iconsmith/src/pipeline/analog.ts";
  const RECIPE = "packages/iconsmith/src/pipeline/recipe.ts";
  const BRANCH = "iconsmith/autoresearch";
  let repo: string;

  const standingText = `# test

\`\`\`editable
${ANALOG}
${RECIPE}
\`\`\`

\`\`\`frozen
packages/iconsmith/autoresearch.md
\`\`\`

\`\`\`holdout
star
compass
quokka
xyzzy
\`\`\`

1. **alpha** — first edit
2. **beta** — second edit
3. **gamma** — third edit
`;

  const write = (rel: string, body: string): void => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), body);
  };

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "autoresearch-"));
    gitIn(repo, ["init", "--initial-branch=main"]);
    gitIn(repo, ["config", "user.email", "loop@test"]);
    gitIn(repo, ["config", "user.name", "loop"]);
    write(ANALOG, "export const analog = 0;\n");
    write(RECIPE, "export const recipes = 0;\n");
    write("packages/iconsmith/autoresearch.md", standingText);
    gitIn(repo, ["add", "-A"]);
    gitIn(repo, ["commit", "-m", "base"]);
  }, GIT.timeout);

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  const standing = () =>
    parseStanding(
      readFileSync(
        path.join(repo, "packages/iconsmith/autoresearch.md"),
        "utf-8"
      )
    );

  it("never writes autoresearch.md", async () => {
    const before = readFileSync(
      path.join(repo, "packages/iconsmith/autoresearch.md"),
      "utf-8"
    );
    const calls: string[] = [];
    await runCampaign(
      {
        branch: BRANCH,
        cwd: repo,
        restoreBranch: false,
        rounds: 1,
        standing: path.join(repo, "packages/iconsmith/autoresearch.md"),
      },
      {
        applyEdit: (item, _s, root) => {
          calls.push(item.id);
          writeFileSync(
            path.join(root, ANALOG),
            `export const analog = "${item.id}";\n`
          );
          return { description: item.id, kind: "applied" };
        },
        measure: () =>
          Promise.resolve(board({ correctAndClean: 10 + calls.length })),
      }
    );
    expect(
      readFileSync(
        path.join(repo, "packages/iconsmith/autoresearch.md"),
        "utf-8"
      )
    ).toBe(before);
    expect(() =>
      gitIn(repo, [
        "diff-tree",
        "-r",
        "--name-only",
        "--no-commit-id",
        "main",
        BRANCH,
      ])
    ).not.toThrow();
    const touched = gitIn(repo, [
      "diff-tree",
      "-r",
      "--name-only",
      "--no-commit-id",
      "main",
      BRANCH,
    ]);
    expect(touched).not.toContain("autoresearch.md");
  });

  it("keeps an advance on the experiment branch and discards a flat remasure", async () => {
    let n = 0;
    const records = await runCampaign(
      {
        branch: BRANCH,
        cwd: repo,
        restoreBranch: false,
        rounds: 2,
        standing: path.join(repo, "packages/iconsmith/autoresearch.md"),
      },
      {
        applyEdit: (item, _s, root) => {
          writeFileSync(
            path.join(root, ANALOG),
            `export const analog = "${item.id}";\n`
          );
          return { description: item.id, kind: "applied" };
        },
        measure: () => {
          n += 1;
          // 1 baseline, 2 after keep, 3 baseline after keep, 4 after no-advance
          return Promise.resolve(board({ correctAndClean: n === 2 ? 11 : 10 }));
        },
      }
    );
    expect(records).toHaveLength(2);
    expect(records[0]?.status).toBe("keep");
    expect(records[1]?.status).toBe("discard");
    expect(gitIn(repo, ["rev-parse", "--abbrev-ref", BRANCH])).toBe(BRANCH);
    expect(gitIn(repo, ["show", `${records[0]?.commit}:${ANALOG}`])).toContain(
      "alpha"
    );
    expect(gitIn(repo, ["show", `${BRANCH}:${ANALOG}`])).toContain("alpha");
    expect(readFileSync(path.join(repo, ANALOG), "utf-8")).toContain("alpha");
    expect(standing().holdout).toEqual([...HOLD_OUT_UNKNOWN]);
  });

  it("stops after --rounds even when the playbook has more items", async () => {
    let applies = 0;
    const records = await runCampaign(
      {
        branch: BRANCH,
        cwd: repo,
        restoreBranch: false,
        rounds: 2,
        standing: path.join(repo, "packages/iconsmith/autoresearch.md"),
      },
      {
        applyEdit: (item, _s, root) => {
          applies += 1;
          writeFileSync(
            path.join(root, ANALOG),
            `export const analog = "${item.id}-${applies}";\n`
          );
          return { description: item.id, kind: "applied" };
        },
        measure: () => Promise.resolve(board()),
      }
    );
    expect(records).toHaveLength(2);
    expect(applies).toBe(2);
    expect(records.every((row) => row.status === "discard")).toBe(true);
  });

  it("crashes and reverts when an edit touches a frozen path", async () => {
    const records = await runCampaign(
      {
        branch: BRANCH,
        cwd: repo,
        restoreBranch: false,
        rounds: 1,
        standing: path.join(repo, "packages/iconsmith/autoresearch.md"),
      },
      {
        applyEdit: (_item, _s, root) => {
          writeFileSync(
            path.join(root, "packages/iconsmith/autoresearch.md"),
            "# rewritten\n"
          );
          return { description: "tamper", kind: "applied" };
        },
        measure: () => Promise.resolve(board()),
      }
    );
    expect(records[0]?.status).toBe("crash");
    expect(
      readFileSync(
        path.join(repo, "packages/iconsmith/autoresearch.md"),
        "utf-8"
      )
    ).toBe(standingText);
  });

  it("writes NEXT.md on an exhausted playbook instead of dying", async () => {
    const records = await runCampaign(
      {
        branch: BRANCH,
        cwd: repo,
        restoreBranch: false,
        rounds: 2,
        standing: path.join(repo, "packages/iconsmith/autoresearch.md"),
      },
      {
        applyEdit: () => ({ description: "nothing left", kind: "skip" }),
        measure: () => Promise.resolve(board({ correctAndClean: 10 })),
      }
    );
    expect(records).toHaveLength(2);
    expect(records.every((row) => row.status === "idle")).toBe(true);
    const next = path.join(
      repo,
      "packages/iconsmith/.staging/autoresearch/NEXT.md"
    );
    expect(readFileSync(next, "utf-8")).toMatch(/Cloud Agent spawn brief/u);
    expect(readFileSync(next, "utf-8")).toMatch(/cannot launch/u);
    expect(dirtyPaths(repo)).toEqual([]);
  });

  it("allows the untracked ledger and refuses any other dirty path", () => {
    mkdirSync(path.join(repo, "packages/iconsmith/.staging/autoresearch"), {
      recursive: true,
    });
    writeFileSync(
      path.join(repo, "packages/iconsmith/.staging/autoresearch/results.tsv"),
      "commit\tmetric\tstatus\tdescription\tprogram\n"
    );
    expect(dirtyPaths(repo)).toEqual([]);
    writeFileSync(path.join(repo, RECIPE), "export const recipes = 1;\n");
    expect(dirtyPaths(repo)).toEqual([RECIPE]);
  });
});

describe("editable globs", () => {
  it("matches a pipeline file and freezes render.ts over tools/**", () => {
    expect(
      pathMatches(
        "packages/iconsmith/src/pipeline/analog.ts",
        "packages/iconsmith/src/pipeline/**"
      )
    ).toBe(true);
    expect(
      pathMatches(
        "packages/iconsmith/src/tools/twin.ts",
        "packages/iconsmith/src/tools/**"
      )
    ).toBe(true);
    expect(
      pathMatches(
        "packages/iconsmith/src/tools/render.ts",
        "packages/iconsmith/src/tools/**"
      )
    ).toBe(true);
    const standing = parseStanding(`# t

\`\`\`editable
packages/iconsmith/src/pipeline/**
packages/iconsmith/src/tools/**
\`\`\`

\`\`\`frozen
packages/iconsmith/src/tools/render.ts
\`\`\`
`);
    expect(
      isEditablePath("packages/iconsmith/src/pipeline/analog.ts", standing)
    ).toBe(true);
    expect(
      isEditablePath("packages/iconsmith/src/tools/twin.ts", standing)
    ).toBe(true);
    expect(
      isFrozenPath("packages/iconsmith/src/tools/render.ts", standing)
    ).toBe(true);
    expect(
      isEditablePath("packages/iconsmith/src/tools/render.ts", standing)
    ).toBe(false);
  });
});

describe("the Cloud Agent brief", () => {
  it("does not invent a launcher in this environment", () => {
    expect(findCloudAgentLauncher()).toBeNull();
  });

  it("renders a pasteable spawn brief with metric, leftover, and gates", () => {
    const standing = readStanding(STANDING);
    const body = renderCloudBrief({
      branch: "cursor/autoresearch-c1f5",
      lastKeep: "none",
      leftover: "concept-correct net-new: analog still unknown for home",
      metric: "correct=10 holes=0 pair=0 gap=0",
      standing,
    });
    expect(body).toMatch(/https:\/\/cursor\.com\/agents/u);
    expect(body).toMatch(/cannot launch/u);
    expect(body).toMatch(/cursor\/autoresearch-c1f5/u);
    expect(body).toMatch(/iconsmith\/autoresearch/u);
    expect(body).toMatch(/Do not merge/u);
    expect(body).toMatch(/If the floor drops, revert/u);
    expect(body).toMatch(/unknown for home/u);
    expect(body).toContain("packages/iconsmith/src/pipeline/**");
    expect(body).toContain("packages/iconsmith/src/tools/render.ts");
  });
});

describe("readStanding", () => {
  it("is AutoresearchError when the file is missing", () => {
    try {
      readStanding("/tmp/does-not-exist-autoresearch.md");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AutoresearchError);
    }
  });
});
