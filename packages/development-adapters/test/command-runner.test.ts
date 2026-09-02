import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  StructuredCommandRunner,
  NodeStructuredProcessExecutor,
  type ProcessExecutionRequest,
  type ProcessExecutionResult,
  type StructuredProcessExecutor,
} from "../src/command-runner.js";
import { ToolPolicyEngine } from "../src/workspace-policy.js";

const at = "2026-08-29T10:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class StubExecutor implements StructuredProcessExecutor {
  public readonly requests: ProcessExecutionRequest[] = [];

  public constructor(public result: ProcessExecutionResult) {}

  public async run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    this.requests.push(request);
    return this.result;
  }
}

function setup(result: ProcessExecutionResult = { exitCode: 0, stdout: "ok", stderr: "" }) {
  const root = mkdtempSync(join(tmpdir(), "product-woc-command-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "packages"));
  const executor = new StubExecutor(result);
  const policy = new ToolPolicyEngine("1.0.0", [
    { templateId: "lint", kind: "lint", executable: "pnpm", args: ["lint"], timeoutMs: 60_000 },
    { templateId: "install", kind: "install_dependency", executable: "pnpm", args: ["add", "zod@4.1.5"], timeoutMs: 60_000 },
    { templateId: "deploy", kind: "deploy", executable: "pnpm", args: ["run", "deploy"], timeoutMs: 60_000 },
  ]);
  return { root, executor, runner: new StructuredCommandRunner(root, policy, executor) };
}

describe("StructuredCommandRunner", () => {
  it("executes only the fixed argv from an approved template", async () => {
    const { root, executor, runner } = setup();
    const result = await runner.run(
      { requestId: "lint-1", templateId: "lint", cwdRelativePath: "packages" },
      at,
    );

    expect(result).toMatchObject({
      executed: true,
      exitCode: 0,
      failureCategory: "none",
    });
    expect(executor.requests).toEqual([
      expect.objectContaining({ executable: "pnpm", args: ["lint"], cwd: join(realpathSync(root), "packages") }),
    ]);
  });

  it("does not execute dependency installation without exact user confirmation", async () => {
    const { executor, runner } = setup();
    const paused = await runner.run(
      { requestId: "install-1", templateId: "install", cwdRelativePath: "." },
      at,
    );
    expect(paused).toMatchObject({
      executed: false,
      decision: { disposition: "requires_confirmation" },
    });
    expect(executor.requests).toHaveLength(0);

    const accepted = await runner.run(
      {
        requestId: "install-2",
        templateId: "install",
        cwdRelativePath: ".",
        confirmation: {
          confirmationId: "confirm-install",
          actorType: "user",
          actorId: "user-1",
          templateId: "install",
          relativePaths: [],
          confirmedAt: at,
        },
      },
      at,
    );
    expect(accepted.executed).toBe(true);
    expect(executor.requests).toHaveLength(1);
  });

  it("never executes deployment even with a user confirmation", async () => {
    const { executor, runner } = setup();
    const result = await runner.run(
      {
        requestId: "deploy-1",
        templateId: "deploy",
        cwdRelativePath: ".",
        confirmation: {
          confirmationId: "confirm-deploy",
          actorType: "user",
          actorId: "user-1",
          templateId: "deploy",
          relativePaths: [],
          confirmedAt: at,
        },
      },
      at,
    );
    expect(result).toMatchObject({
      executed: false,
      decision: { disposition: "denied", reason: "permanently_denied" },
    });
    expect(executor.requests).toHaveLength(0);
  });

  it("rejects an outside or symlink working directory", async () => {
    const { root, executor, runner } = setup();
    const outside = mkdtempSync(join(tmpdir(), "product-woc-command-outside-"));
    temporaryDirectories.push(outside);
    symlinkSync(outside, join(root, "linked"));
    expect(
      await runner.run(
        { requestId: "outside-1", templateId: "lint", cwdRelativePath: "../outside" },
        at,
      ),
    ).toMatchObject({ executed: false, decision: { reason: "path_policy_denied" } });
    expect(
      await runner.run(
        { requestId: "symlink-1", templateId: "lint", cwdRelativePath: "linked" },
        at,
      ),
    ).toMatchObject({ executed: false, decision: { reason: "path_policy_denied" } });
    expect(executor.requests).toHaveLength(0);
  });

  it("redacts secrets and absolute paths from results and Tool Events", async () => {
    const { root, executor, runner } = setup();
    executor.result = {
      exitCode: 1,
      stdout: "",
      stderr: `token=secret-value-12345678 owner@example.invalid at ${realpathSync(root)}`,
    };
    const result = await runner.run(
      { requestId: "lint-secret", templateId: "lint", cwdRelativePath: "." },
      at,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-value-12345678");
    expect(serialized).not.toContain("owner@example.invalid");
    expect(serialized).not.toContain(root);
    expect(result.event.redactedArguments).toEqual([
      "template:lint",
      "kind:lint",
      "cwd:<workspace>",
    ]);
  });

  it("preserves infrastructure failure classification separately from test failure", async () => {
    const { executor, runner } = setup({
      exitCode: 127,
      stdout: "",
      stderr: "executable missing",
      errorCategory: "command_not_found",
    });
    const missing = await runner.run(
      { requestId: "missing-command", templateId: "lint", cwdRelativePath: "." },
      at,
    );
    executor.result = { exitCode: 1, stdout: "", stderr: "lint failed" };
    const failed = await runner.run(
      { requestId: "failed-command", templateId: "lint", cwdRelativePath: "." },
      at,
    );

    expect(missing.failureCategory).toBe("command_not_found");
    expect(failed.failureCategory).toBe("verification_failed");
  });
});

describe("NodeStructuredProcessExecutor failure classes", () => {
  it("classifies a missing executable without treating it as a test failure", async () => {
    const executor = new NodeStructuredProcessExecutor();
    await expect(
      executor.run({
        executable: "product-woc-command-that-does-not-exist",
        args: [],
        cwd: tmpdir(),
        timeoutMs: 1_000,
        env: { PATH: process.env.PATH },
      }),
    ).resolves.toMatchObject({
      exitCode: 127,
      errorCategory: "command_not_found",
    });
  });

  it("terminates and classifies a timed-out process", async () => {
    const executor = new NodeStructuredProcessExecutor();
    await expect(
      executor.run({
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: tmpdir(),
        timeoutMs: 20,
        env: { PATH: process.env.PATH },
      }),
    ).resolves.toMatchObject({ errorCategory: "timeout" });
  });
});
