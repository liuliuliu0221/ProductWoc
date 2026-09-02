import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  PatchJournalEntry,
  TaskRun,
} from "@product-woc/development-contracts";
import {
  NodeWorkspaceAdapter,
  StructuredCommandRunner,
  ToolPolicyEngine,
  type ProcessExecutionRequest,
  type ProcessExecutionResult,
  type StructuredProcessExecutor,
} from "@product-woc/development-adapters";
import { taskDefinitionHash } from "@product-woc/development-domain";
import {
  executionTaskSchema,
  type EvidenceType,
  type ExecutionTask,
} from "@product-woc/planning-contracts";

import { TaskVerificationService } from "../src/verification.js";

const at = "2026-08-29T14:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class SequenceExecutor implements StructuredProcessExecutor {
  public requests: ProcessExecutionRequest[] = [];

  public constructor(private readonly results: readonly ProcessExecutionResult[]) {}

  public async run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    this.requests.push(request);
    return (
      this.results[this.requests.length - 1] ?? {
        exitCode: 1,
        stdout: "",
        stderr: "missing fixture result",
      }
    );
  }
}

function executionTask(types: readonly EvidenceType[]): ExecutionTask {
  return executionTaskSchema.parse({
    id: "task-verify",
    phaseId: "phase-verify",
    title: "Verify the implementation",
    description: "Run every required local verification.",
    dependsOn: [],
    inputs: ["Applied Patch"],
    outputs: ["Evidence Manifest"],
    requirementIds: ["REQ-1"],
    acceptanceCriterionIds: ["AC-1"],
    designItemIds: ["DES-1"],
    completionCriteria: ["All verification passes"],
    verificationSteps: types.map((evidenceType, index) => ({
      id: `verify-${index + 1}`,
      description: `Verify ${evidenceType}`,
      evidenceType,
      required: true,
    })),
    repairStrategy: "Repair the smallest failing boundary.",
    rollbackStrategy: "Roll back the current Task Patch.",
    riskLevel: "low",
  });
}

function taskRun(task: ExecutionTask): TaskRun {
  return {
    taskRunId: "task-run-verify",
    developmentRunId: "development-run-1",
    executionTaskId: task.id,
    taskDefinitionHash: taskDefinitionHash(task),
    status: "verifying",
    revision: 4,
    modelSnapshotId: "model-snapshot-verify",
    agentRunIds: ["agent-run-verify"],
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
}

function journal(): PatchJournalEntry {
  return {
    journalEntryId: "journal-verify",
    patchSetId: "patch-set-verify",
    proposalId: "proposal-verify",
    proposalHash: "1".repeat(64),
    idempotencyKey: "idempotency-verify",
    developmentRunId: "development-run-1",
    taskRunId: "task-run-verify",
    agentRunId: "agent-run-verify",
    contextSnapshotId: "context-verify",
    modelSnapshotId: "model-snapshot-verify",
    status: "applied",
    operations: [],
    workspaceManifestBeforeHash: "2".repeat(64),
    workspaceManifestAfterHash: "3".repeat(64),
    diffHash: "4".repeat(64),
    toolPolicyVersion: "1.0.0",
    rollbackAvailable: true,
    appliedAt: at,
  };
}

function setup(results: readonly ProcessExecutionResult[]) {
  const root = mkdtempSync(join(tmpdir(), "product-woc-verification-"));
  temporaryDirectories.push(root);
  writeFileSync(join(root, "source.ts"), "export const fixture = true;\n");
  const executor = new SequenceExecutor(results);
  const policy = new ToolPolicyEngine("1.0.0", [
    { templateId: "verify-test", kind: "test", executable: "pnpm", args: ["test"], timeoutMs: 60_000 },
    { templateId: "verify-typecheck", kind: "typecheck", executable: "pnpm", args: ["typecheck"], timeoutMs: 60_000 },
    { templateId: "verify-lint", kind: "lint", executable: "pnpm", args: ["lint"], timeoutMs: 60_000 },
    { templateId: "verify-build", kind: "build", executable: "pnpm", args: ["build"], timeoutMs: 60_000 },
  ]);
  const workspace = new NodeWorkspaceAdapter(root);
  const commands = new StructuredCommandRunner(root, policy, executor);
  return {
    executor,
    service: new TaskVerificationService(commands, workspace),
  };
}

const commandTypes = [
  "test_report",
  "typecheck",
  "lint_report",
  "build_artifact",
] as const;
const templateMap = {
  test_report: "verify-test",
  typecheck: "verify-typecheck",
  lint_report: "verify-lint",
  build_artifact: "verify-build",
};

describe("TaskVerificationService", () => {
  it("creates passing Evidence and full redacted Artifacts for all command classes", async () => {
    const output =
      "passed for dev@example.invalid token=secret-value-12345678";
    const { service } = setup(
      commandTypes.map(() => ({ exitCode: 0, stdout: output, stderr: "" })),
    );
    const task = executionTask(commandTypes);
    const result = await service.run({
      verificationRunId: "verification-run-pass",
      taskRun: taskRun(task),
      executionTask: task,
      patchJournalEntry: journal(),
      templateMap,
      cwdRelativePath: ".",
      completedAt: at,
    });

    expect(result.manifest.status).toBe("passed");
    expect(result.evidence.map(({ type }) => type)).toEqual([
      "test_report",
      "typecheck_report",
      "lint_report",
      "build_report",
    ]);
    expect(result.evidence.every(({ outcome }) => outcome === "passed")).toBe(true);
    expect(JSON.stringify(result.artifacts)).not.toContain("dev@example.invalid");
    expect(JSON.stringify(result.artifacts)).not.toContain("secret-value-12345678");
    expect(service.artifacts.list()).toHaveLength(4);
  });

  it("creates failed Evidence fixtures for all command classes", async () => {
    const { service } = setup(
      commandTypes.map(() => ({
        exitCode: 1,
        stdout: "",
        stderr: "verification failed",
      })),
    );
    const task = executionTask(commandTypes);
    const result = await service.run({
      verificationRunId: "verification-run-fail",
      taskRun: taskRun(task),
      executionTask: task,
      patchJournalEntry: journal(),
      templateMap,
      cwdRelativePath: ".",
      completedAt: at,
    });

    expect(result.manifest.status).toBe("failed");
    expect(result.evidence.every(({ outcome }) => outcome === "failed")).toBe(true);
    expect(
      result.evidence.every(
        ({ errorCategory }) => errorCategory === "verification_failed",
      ),
    ).toBe(true);
  });

  it("distinguishes a missing command from an ordinary test failure", async () => {
    const { service } = setup([
      {
        exitCode: 127,
        stdout: "",
        stderr: "command not found",
        errorCategory: "command_not_found",
      },
      { exitCode: 1, stdout: "", stderr: "assertion failed" },
    ]);
    const task = executionTask(["test_report", "test_report"]);
    const result = await service.run({
      verificationRunId: "verification-run-category",
      taskRun: taskRun(task),
      executionTask: task,
      patchJournalEntry: journal(),
      templateMap,
      cwdRelativePath: ".",
      completedAt: at,
    });

    expect(result.evidence.map(({ errorCategory }) => errorCategory)).toEqual([
      "command_not_found",
      "verification_failed",
    ]);
  });

  it("keeps manual Evidence in review until an exact user confirmation exists", async () => {
    const { service } = setup([]);
    const task = executionTask(["manual_approval"]);
    const pending = await service.run({
      verificationRunId: "verification-run-manual-pending",
      taskRun: taskRun(task),
      executionTask: task,
      patchJournalEntry: journal(),
      templateMap: {},
      cwdRelativePath: ".",
      completedAt: at,
    });
    expect(pending.manifest.status).toBe("requires_review");

    const confirmed = await service.run({
      verificationRunId: "verification-run-manual-confirmed",
      taskRun: taskRun(task),
      executionTask: task,
      patchJournalEntry: journal(),
      templateMap: {},
      cwdRelativePath: ".",
      completedAt: at,
      manualRecords: [
        {
          verificationStepId: "verify-1",
          content: "Reviewed by the local user.",
          outcome: "passed",
          confirmation: {
            confirmationId: "manual-confirmation-1",
            actorType: "user",
            actorId: "user-1",
            templateId: "verify-1",
            relativePaths: [],
            confirmedAt: at,
          },
        },
      ],
    });
    expect(confirmed.manifest.status).toBe("passed");
    expect(confirmed.evidence[0]).toMatchObject({
      producer: "user",
      confirmationId: "manual-confirmation-1",
    });
  });

  it("rejects a Patch Journal from another Agent Run", async () => {
    const { service } = setup([{ exitCode: 0, stdout: "ok", stderr: "" }]);
    const task = executionTask(["test_report"]);
    await expect(
      service.run({
        verificationRunId: "verification-run-stale-agent",
        taskRun: taskRun(task),
        executionTask: task,
        patchJournalEntry: { ...journal(), agentRunId: "another-agent" },
        templateMap,
        cwdRelativePath: ".",
        completedAt: at,
      }),
    ).rejects.toThrow(/current Task Patch/);
  });
});
