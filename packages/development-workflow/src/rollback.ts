import type {
  PatchJournalEntry,
  PatchRollbackResult,
  ToolConfirmation,
} from "@product-woc/development-contracts";
import type { PatchTransactionManager } from "@product-woc/development-adapters";
import {
  requireDevelopmentUserAction,
  transitionTask,
  type DevelopmentAggregate,
} from "@product-woc/development-domain";

export function rollbackCurrentTaskPatch(input: {
  aggregate: DevelopmentAggregate;
  patches: PatchTransactionManager;
  rollbackId: string;
  taskRunId: string;
  journalEntry: PatchJournalEntry;
  confirmation: ToolConfirmation;
  rolledBackAt: string;
}): { aggregate: DevelopmentAggregate; result: PatchRollbackResult } {
  const task = input.aggregate.taskRuns[input.taskRunId];
  if (
    !task ||
    (task.status !== "verifying" && task.status !== "repairing") ||
    input.journalEntry.taskRunId !== task.taskRunId
  ) {
    throw new Error("Rollback does not match the current Task");
  }
  const result = input.patches.rollback({
    rollbackId: input.rollbackId,
    journalEntry: input.journalEntry,
    taskRunId: input.taskRunId,
    confirmation: input.confirmation,
    rolledBackAt: input.rolledBackAt,
  });
  if (result.rolledBack) {
    const transition = transitionTask(input.aggregate, {
      requestId: `mark-rolled-back:${input.rollbackId}`,
      taskRunId: input.taskRunId,
      toStatus: "rolled_back",
      transitionedAt: input.rolledBackAt,
    });
    return { aggregate: transition.aggregate, result };
  }
  if (result.reason === "hash_conflict" || result.reason === "apply_failed") {
    const needsUser = requireDevelopmentUserAction(input.aggregate, {
      requestId: `rollback-needs-user:${input.rollbackId}`,
      taskRunId: input.taskRunId,
      reason: "rollback_conflict",
      requiredAt: input.rolledBackAt,
    });
    return { aggregate: needsUser.aggregate, result };
  }
  return { aggregate: input.aggregate, result };
}
