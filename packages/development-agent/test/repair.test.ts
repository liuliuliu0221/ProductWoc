import { describe, expect, it } from "vitest";

import {
  taskContextSnapshotSchema,
  verificationEvidenceSchema,
  type TaskContextSnapshot,
  type VerificationErrorCategory,
} from "@product-woc/development-contracts";
import { contentHash } from "@product-woc/development-domain";

import {
  createRepairSession,
  recordRepairAttemptStatus,
  requestRepair,
} from "../src/repair.js";

const at = "2026-08-29T15:00:00.000Z";

function context(): TaskContextSnapshot {
  const withoutHash = {
    contextSnapshotId: "context-repair",
    developmentRunId: "development-run-1",
    taskRunId: "task-run-1",
    agentRunId: "agent-run-implementation",
    executionTaskId: "task-1",
    taskDefinitionHash: "1".repeat(64),
    projectSpecVersionId: "spec-1",
    technicalDesignVersionId: "design-1",
    executionPlanVersionId: "plan-1",
    allowedWritePaths: ["src/**"],
    blocks: [
      {
        blockId: "block-task",
        kind: "execution_task" as const,
        sourceId: "task-1",
        sourceHash: "2".repeat(64),
        content: "Current Task",
        trust: "untrusted_reference" as const,
        instructionAuthority: "none" as const,
        inclusionReason: "Current Task",
        redacted: false,
        truncated: false,
      },
    ],
    sources: [
      {
        sourceId: "task-1",
        sourceHash: "2".repeat(64),
        kind: "execution_task" as const,
        includedBlockIds: ["block-task"],
        redacted: false,
        truncated: false,
      },
    ],
    excludedCategories: ["full_chat_history" as const],
    createdAt: at,
  };
  return taskContextSnapshotSchema.parse({
    ...withoutHash,
    contextHash: contentHash(withoutHash),
  });
}

function failure(
  suffix: string,
  errorCategory: Exclude<VerificationErrorCategory, "none"> =
    "verification_failed",
) {
  return verificationEvidenceSchema.parse({
    evidenceId: `failure-${suffix}`,
    developmentRunId: "development-run-1",
    taskRunId: "task-run-1",
    verificationStepId: "verify-tests",
    taskDefinitionHash: "1".repeat(64),
    modelSnapshotId: "model-1",
    type: "test_report",
    producer: "verification_runner",
    artifactId: `artifact-${suffix}`,
    artifactHash: contentHash(["artifact", suffix]),
    patchJournalEntryId: "journal-1",
    commandResultHash: contentHash(["command", suffix]),
    exitCode: errorCategory === "command_not_found" ? 127 : 1,
    errorCategory,
    summary: `Redacted failure ${suffix}`,
    workspaceHash: "3".repeat(64),
    outcome: "failed",
    producedAt: at,
  });
}

function requestInput(session: ReturnType<typeof createRepairSession>, suffix: string) {
  return {
    session,
    sourceContext: context(),
    failureEvidence: failure(suffix),
    repairAttemptId: `repair-attempt-${suffix}`,
    repairContextId: `repair-context-${suffix}`,
    agentRunId: `repair-agent-${suffix}`,
    modelSnapshotId: `repair-model-${suffix}`,
    patchSetId: `repair-patch-${suffix}`,
    createdAt: at,
  };
}

describe("Repair budget and stop policy", () => {
  it("allows a second distinct Repair and preserves both Agent/Patch histories", () => {
    let session = createRepairSession({
      repairSessionId: "repair-session-1",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      createdAt: at,
    });
    const first = requestRepair(requestInput(session, "one"));
    expect(first).toMatchObject({ allowed: true, reason: "repair_allowed" });
    session = recordRepairAttemptStatus({
      session: first.session,
      repairAttemptId: first.attempt!.repairAttemptId,
      status: "patch_applied",
      completedAt: at,
    });
    session = recordRepairAttemptStatus({
      session,
      repairAttemptId: first.attempt!.repairAttemptId,
      status: "verification_failed",
      completedAt: at,
    });
    const second = requestRepair(requestInput(session, "two"));
    expect(second.allowed).toBe(true);
    session = recordRepairAttemptStatus({
      session: second.session,
      repairAttemptId: second.attempt!.repairAttemptId,
      status: "patch_applied",
      completedAt: at,
    });
    session = recordRepairAttemptStatus({
      session,
      repairAttemptId: second.attempt!.repairAttemptId,
      status: "verified",
      completedAt: at,
    });

    expect(session.status).toBe("verified");
    expect(session.attempts).toHaveLength(2);
    expect(new Set(session.attempts.map(({ agentRunId }) => agentRunId)).size).toBe(2);
    expect(new Set(session.attempts.map(({ patchSetId }) => patchSetId)).size).toBe(2);
  });

  it("moves to user action immediately after the final failed attempt", () => {
    const session = createRepairSession({
      repairSessionId: "repair-session-budget",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      maxAttempts: 1,
      createdAt: at,
    });
    const decision = requestRepair(requestInput(session, "budget"));
    const applied = recordRepairAttemptStatus({
      session: decision.session,
      repairAttemptId: decision.attempt!.repairAttemptId,
      status: "patch_applied",
      completedAt: at,
    });
    const stopped = recordRepairAttemptStatus({
      session: applied,
      repairAttemptId: decision.attempt!.repairAttemptId,
      status: "verification_failed",
      completedAt: at,
    });

    expect(stopped).toMatchObject({
      status: "needs_user_action",
      stopReason: "budget_exhausted",
    });
  });

  it("stops on a repeated failure fingerprint before creating another Agent", () => {
    let session = createRepairSession({
      repairSessionId: "repair-session-repeat",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      createdAt: at,
    });
    const first = requestRepair(requestInput(session, "repeat"));
    session = recordRepairAttemptStatus({
      session: first.session,
      repairAttemptId: first.attempt!.repairAttemptId,
      status: "patch_applied",
      completedAt: at,
    });
    session = recordRepairAttemptStatus({
      session,
      repairAttemptId: first.attempt!.repairAttemptId,
      status: "verification_failed",
      completedAt: at,
    });
    const repeated = requestRepair(requestInput(session, "repeat"));

    expect(repeated).toMatchObject({
      allowed: false,
      reason: "repeated_failure",
      session: { status: "needs_user_action" },
    });
    expect(repeated.session.attempts).toHaveLength(1);
  });

  it.each([
    ["policy_denied", "policy_failure"],
    ["command_not_found", "infrastructure_failure"],
    ["timeout", "infrastructure_failure"],
    ["infrastructure_failure", "infrastructure_failure"],
  ] as const)("does not auto-repair %s", (category, reason) => {
    const session = createRepairSession({
      repairSessionId: `repair-session-${category}`,
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      createdAt: at,
    });
    const decision = requestRepair({
      ...requestInput(session, category),
      failureEvidence: failure(category, category),
    });

    expect(decision).toMatchObject({ allowed: false, reason });
    expect(decision.session.attempts).toHaveLength(0);
  });

  it("binds the Repair Context only to the original Context and failed Evidence", () => {
    const session = createRepairSession({
      repairSessionId: "repair-session-context",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      createdAt: at,
    });
    const input = requestInput(session, "context");
    const decision = requestRepair({
      ...input,
      failureEvidence: {
        ...input.failureEvidence,
        summary:
          "token=secret-value-12345678 owner@example.invalid at /Users/fixture/project",
      },
    });

    expect(decision.context).toMatchObject({
      sourceContextSnapshotId: "context-repair",
      failureEvidenceId: "failure-context",
      allowedWritePaths: ["src/**"],
      previousRepairAttemptIds: [],
    });
    expect(JSON.stringify(decision.context)).not.toContain("full_chat_history");
    expect(JSON.stringify(decision.context)).not.toContain("secret-value-12345678");
    expect(JSON.stringify(decision.context)).not.toContain("owner@example.invalid");
    expect(JSON.stringify(decision.context)).not.toContain("/Users/fixture");
    expect(Object.isFrozen(decision)).toBe(true);
  });
});
