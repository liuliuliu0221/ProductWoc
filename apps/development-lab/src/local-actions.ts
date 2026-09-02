import {
  NodeWorkspaceAdapter,
  PatchTransactionManager,
  StructuredCommandRunner,
  ToolPolicyEngine,
} from "@product-woc/development-adapters";
import {
  controlDevelopmentRun,
  transitionTask,
} from "@product-woc/development-domain";
import {
  completeTaskFromVerification,
  recordVerificationResult,
  rollbackCurrentTaskPatch,
  TaskVerificationService,
} from "@product-woc/development-workflow";

import type { DevelopmentLabActionPort } from "./application.js";

export function createLocalDevelopmentActions(workspaceRoot: string): DevelopmentLabActionPort {
  const workspace = new NodeWorkspaceAdapter(workspaceRoot);
  return {
    verify: async ({ checkpoint, requestId, occurredAt }) => {
      const taskRunId = checkpoint.aggregate.run.currentTaskRunId;
      const task = taskRunId ? checkpoint.aggregate.taskRuns[taskRunId] : undefined;
      const definition = task
        ? checkpoint.aggregate.executionPlan.tasks.find(({ id }) => id === task.executionTaskId)
        : undefined;
      const journal = taskRunId
        ? [...checkpoint.patchJournal].reverse().find(
            (entry) => entry.taskRunId === taskRunId && entry.status === "applied",
          )
        : undefined;
      if (!task || !definition || !journal || task.status !== "verifying") {
        throw new Error("Current Task is not ready for verification");
      }
      const policy = new ToolPolicyEngine("1.0.0", [
        { templateId: "verify-test", kind: "test", executable: "pnpm", args: ["test"], timeoutMs: 10 * 60_000 },
        { templateId: "verify-typecheck", kind: "typecheck", executable: "pnpm", args: ["typecheck"], timeoutMs: 10 * 60_000 },
        { templateId: "verify-lint", kind: "lint", executable: "pnpm", args: ["lint"], timeoutMs: 10 * 60_000 },
        { templateId: "verify-build", kind: "build", executable: "pnpm", args: ["build"], timeoutMs: 10 * 60_000 },
      ]);
      const service = new TaskVerificationService(
        new StructuredCommandRunner(workspaceRoot, policy),
        workspace,
      );
      const result = await service.run({
        verificationRunId: `verification:${requestId}`,
        taskRun: task,
        executionTask: definition,
        patchJournalEntry: journal,
        templateMap: {
          test_report: "verify-test",
          typecheck: "verify-typecheck",
          lint_report: "verify-lint",
          build_artifact: "verify-build",
        },
        cwdRelativePath: ".",
        completedAt: occurredAt,
      });
      const aggregate = result.manifest.status === "passed"
        ? completeTaskFromVerification(checkpoint.aggregate, result, occurredAt)
        : recordVerificationResult(checkpoint.aggregate, result);
      return {
        aggregate,
        artifacts: {
          evidenceManifests: [result.manifest],
          verificationArtifacts: result.artifacts,
        },
        workspaceHash: result.manifest.workspaceHash,
      };
    },
    rollback: async ({ checkpoint, requestId, actorId, occurredAt }) => {
      const taskRunId = checkpoint.aggregate.run.currentTaskRunId;
      const journal = taskRunId
        ? [...checkpoint.patchJournal].reverse().find(
            (entry) => entry.taskRunId === taskRunId && entry.status === "applied",
          )
        : undefined;
      if (!taskRunId || !journal) throw new Error("Current Task has no applied Patch");
      const rolledBack = rollbackCurrentTaskPatch({
        aggregate: checkpoint.aggregate,
        patches: new PatchTransactionManager(workspace),
        rollbackId: `rollback:${requestId}`,
        taskRunId,
        journalEntry: journal,
        confirmation: {
          confirmationId: `confirmation:${requestId}`,
          actorType: "user",
          actorId,
          templateId: journal.patchSetId,
          relativePaths: journal.operations.map(({ relativePath }) => relativePath),
          confirmedAt: occurredAt,
        },
        rolledBackAt: occurredAt,
      });
      return {
        aggregate: rolledBack.aggregate,
        workspaceHash: workspace.contentManifestHash(),
      };
    },
    retry: async ({ checkpoint, requestId, occurredAt }) => {
      const taskRunId = checkpoint.aggregate.run.currentTaskRunId;
      const task = taskRunId ? checkpoint.aggregate.taskRuns[taskRunId] : undefined;
      if (!task || !["blocked", "failed", "rolled_back", "stale"].includes(task.status)) {
        throw new Error("Current Task is not retryable");
      }
      let aggregate = checkpoint.aggregate;
      if (["paused", "needs_user_action"].includes(aggregate.run.status)) {
        aggregate = controlDevelopmentRun(aggregate, {
          requestId: `resume:${requestId}`,
          action: "resume",
          actorId: "local-user",
          reason: "Retry current Task",
          occurredAt,
        }).aggregate;
      }
      const transition = transitionTask(aggregate, {
        requestId: `retry:${requestId}`,
        taskRunId: task.taskRunId,
        toStatus: "ready",
        transitionedAt: occurredAt,
      });
      if (!transition.result.accepted) throw new Error(`Retry rejected: ${transition.result.reason}`);
      return transition.aggregate;
    },
  };
}
