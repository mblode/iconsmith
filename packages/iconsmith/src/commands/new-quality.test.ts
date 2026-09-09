import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MissingApiKeyError } from "../pipeline/generate.js";
import { reach } from "../pipeline/reach.js";
import { registerNewCommand } from "./new.js";

vi.mock("../pipeline/reach.js", () => ({ reach: vi.fn() }));
const draw = vi.mocked(reach);
const result = {
  clean: true,
  doc: { icon: "search-check" },
  issues: [],
  steps: 1,
  svg: "<svg/>",
  text: "generated",
  trace: ["draw"],
} as Awaited<ReturnType<typeof reach>>;
const run = async (...args: string[]) => {
  const command = new Command().option("--output <format>");
  registerNewCommand(command);
  await command.parseAsync(["node", "iconsmith", ...args]);
};
afterEach(() => {
  vi.restoreAllMocks();
  draw.mockReset();
  process.exitCode = undefined;
});
describe("new draft contract", () => {
  it("forces AI and never grants craft approval for clean geometry", async () => {
    draw.mockResolvedValue(result);
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await run("--output", "json", "new", "search-check");
    expect(draw.mock.calls[0]?.[1]).toMatchObject({
      forceAgent: true,
      unkeyed: "agent",
    });
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      assessment: "structural-only",
      clean: true,
      craftApproved: false,
      status: "draft",
      visualReview: "required",
    });
  });
  it("keeps cheap routing explicit and text output marked draft", async () => {
    draw.mockResolvedValue(result);
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await run("new", "search-check", "--mixture");
    expect(draw.mock.calls[0]?.[1]).toMatchObject({
      forceAgent: false,
      unkeyed: "mixture",
    });
    expect(stderr.mock.calls.flat().join("")).toContain(
      "draft — no lint errors; semantic and visual review required"
    );
  });
  it("does not fall back when default author credentials are absent", async () => {
    draw.mockRejectedValue(new MissingApiKeyError());
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await run("new", "search-check");
    expect(draw).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
  it("fails invalid JSON drafts", async () => {
    draw.mockResolvedValue({ ...result, clean: false });
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await run("--output", "json", "new", "search-check");
    expect(process.exitCode).toBe(1);
  });
});
