import { describe, expect, it } from "vitest";

import type { VerificationEvidence } from "@product-woc/development-contracts";

import {
  beginTask,
  beginRepair,
  completeTask,
  controlDevelopmentRun,
  contentHash,
  confirmPhaseGate,
  createDevelopmentAggregate,
  markPlanningRevision,
  recordTaskEvidence,
  recordRepairAttemptOutcome,
  requireDevelopmentUserAction,
  rerunTaskWithModel,
  selectNextReadyTask,
  startDevelopmentRun,
  transitionTask,
  type DevelopmentAggregate,
} from "../src/index.js";
import {
  buildDevelopmentInput,
  executionContentWithGate,
  newDevelopmentAggregate,
} from "./fixtures.js";

const at = "2026-08-29T09:00:00.000Z";

function start(aggregate: DevelopmentAggregate): DevelopmentAggregate {
  return startDevelopmentRun(aggregate, {
    requestId: "start-1",
    startedAt: at,
  }).aggregate;
}

function moveTaskToVerifying(
  aggregate: DevelopmentAggregate,
  taskRunId: string,
  suffix: string,
): DevelopmentAggregate {
  let next = beginTask(aggregate, {
    requestId: `begin-${suffix}`,
    taskRunId,
    agentRunId: `agent-${suffix}`,
    modelSnapshotId: `model-snapshot-${suffix}`,
    begunAt: at,
  }).aggregate;
  for (const [index, toStatus] of [
    "generating_change",
    "applying_patch",
    "verifying",
  ].entries()) {
    next = transitionTask(next, {
      requestId: `transition-${suffix}-${index}`,
      taskRunId,
      toStatus: toStatus as
        | "generating_change"
        | "applying_patch"
        | "verifying",
      transitionedAt: at,
    }).aggregate;
  }
  return next;
}

function evidenceType(
  planningType: string,
): VerificationEvidence["type"] {
  if (planningType === "screenshot") {
    return "screenshot";
  }
  if (planningType === "typecheck") {
    return "typecheck_report";
  }
  if (planningType === "lint_report") {
    return "lint_report";
  }
  return "test_report";
}

function recordRequiredEvidence(
  aggregate: DevelopmentAggregate,
  taskRunId: string,
  suffix: string,
): { aggregate: DevelopmentAggregate; evidenceIds: string[] } {
  let next = aggregate;
  const task = next.taskRuns[taskRunId];
  if (!task?.modelSnapshotId) {
    throw new Error("Task does not have a model snapshot");
  }
  const definition = next.executionPlan.tasks.find(
    ({ id }) => id === task.executionTaskId,
  );
  if (!definition) {
    throw new Error("Task definition is missing");
  }
  const evidenceIds: string[] = [];
  for (const [index, step] of definition.verificationSteps.entries()) {
    if (!step.required) {
      continue;
    }
    const evidenceId = `evidence-${suffix}-${index}`;
    evidenceIds.push(evidenceId);
    next = recordTaskEvidence(next, {
      requestId: `record-evidence-${suffix}-${index}`,
      evidence: {
        evidenceId,
        developmentRunId: next.run.developmentRunId,
        taskRunId,
        verificationStepId: step.id,
        taskDefinitionHash: task.taskDefinitionHash,
        modelSnapshotId: task.modelSnapshotId,
        type: evidenceType(step.evidenceType),
        producer: "verification_runner",
        artifactId: `artifact-${suffix}-${index}`,
        artifactHash: `${index + 1}`.repeat(64),
        patchJournalEntryId: `journal-${suffix}`,
        commandResultHash: `${index + 2}`.repeat(64),
        exitCode: 0,
        errorCategory: "none",
        summary: "Fixture verification passed",
        workspaceHash: "f".repeat(64),
        outcome: "passed",
        producedAt: at,
      },
    }).aggregate;
  }
  return { aggregate: next, evidenceIds };
}

function completeReadyTask(
  aggregate: DevelopmentAggregate,
  suffix: string,
): {
  aggregate: DevelopmentAggregate;
  taskRunId: string;
  evidenceIds: string[];
  completeRequestId: string;
} {
  const ready = selectNextReadyTask(aggregate);
  if (!ready) {
    throw new Error("No ready task");
  }
  let next = moveTaskToVerifying(aggregate, ready.taskRunId, suffix);
  const recorded = recordRequiredEvidence(next, ready.taskRunId, suffix);
  next = recorded.aggregate;
  const completeRequestId = `complete-${suffix}`;
  next = completeTask(next, {
    requestId: completeRequestId,
    taskRunId: ready.taskRunId,
    evidenceIds: recorded.evidenceIds,
    completedAt: at,
  }).aggregate;
  return {
    aggregate: next,
    taskRunId: ready.taskRunId,
    evidenceIds: recorded.evidenceIds,
    completeRequestId,
  };
}

describe("development aggregate input boundary", () => {
  it("creates an immutable snapshot bound to approved planning documents", () => {
    const creation = createDevelopmentAggregate(buildDevelopmentInput());
    expect(creation.created).toBe(true);
    if (!creation.created) {
      return;
    }
    expect(creation.aggregate.run.status).toBe("ready");
    expect(creation.aggregate.input.taskGraphHash).toBe(
      creation.aggregate.graph.graphHash,
    );
    expect(Object.isFrozen(creation.aggregate.input)).toBe(true);
    expect(Object.values(creation.aggregate.taskRuns)).toHaveLength(2);
  });

  it("rejects a tampered envelope and a stale planning pointer", () => {
    const tampered = buildDevelopmentInput();
    tampered.envelope = {
      ...tampered.envelope,
      executionPlanHash: "9".repeat(64),
    };
    const tamperedResult = createDevelopmentAggregate(tampered);
    expect(tamperedResult).toMatchObject({
      created: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "document_binding_mismatch" }),
      ]),
    });

    const stale = buildDevelopmentInput();
    stale.authority = {
      ...stale.authority,
      snapshot: {
        ...stale.authority.snapshot,
        executionPlan: {
          ...stale.authority.snapshot.executionPlan!,
          valid: false,
        },
      },
    };
    expect(createDevelopmentAggregate(stale)).toMatchObject({
      created: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "document_binding_mismatch" }),
      ]),
    });
  });
});

describe("development lifecycle controls", () => {
  it("pauses, resumes idempotently, and cancels active entities", () => {
    let aggregate = start(newDevelopmentAggregate());
    const paused = controlDevelopmentRun(aggregate, {
      requestId: "pause-development-1",
      action: "pause",
      actorId: "local-user",
      reason: "Pause at the current safe boundary",
      occurredAt: at,
    });
    expect(paused.result.accepted).toBe(true);
    expect(paused.aggregate.run.status).toBe("paused");

    const resumed = controlDevelopmentRun(paused.aggregate, {
      requestId: "resume-development-1",
      action: "resume",
      actorId: "local-user",
      reason: "Continue local development",
      occurredAt: at,
    });
    const replay = controlDevelopmentRun(resumed.aggregate, {
      requestId: "resume-development-1",
      action: "resume",
      actorId: "local-user",
      reason: "Continue local development",
      occurredAt: at,
    });
    expect(resumed.aggregate.run.status).toBe("running");
    expect(replay.aggregate).toEqual(resumed.aggregate);

    aggregate = controlDevelopmentRun(replay.aggregate, {
      requestId: "cancel-development-1",
      action: "cancel",
      actorId: "local-user",
      reason: "Stop this run",
      occurredAt: at,
    }).aggregate;
    expect(aggregate.run.status).toBe("cancelled");
    expect(
      Object.values(aggregate.phaseRuns).filter(({ status }) => status !== "completed")
        .every(({ status }) => status === "cancelled"),
    ).toBe(true);
    expect(
      Object.values(aggregate.taskRuns).filter(({ status }) => status !== "completed")
        .every(({ status }) => status === "cancelled"),
    ).toBe(true);
  });
});

describe("development scheduling, evidence, gate, and idempotency", () => {
  it("starts once and selects tasks in deterministic dependency order", () => {
    const initial = newDevelopmentAggregate();
    const command = { requestId: "start-1", startedAt: at };
    const first = startDevelopmentRun(initial, command);
    const replay = startDevelopmentRun(first.aggregate, command);

    expect(first.result.accepted).toBe(true);
    expect(selectNextReadyTask(first.aggregate)?.executionTaskId).toBe(
      "task-foundation",
    );
    expect(replay.result).toEqual(first.result);
    expect(replay.aggregate.transitionHistory).toEqual(
      first.aggregate.transitionHistory,
    );
  });

  it("does not complete a task without all required passing evidence", () => {
    let aggregate = start(newDevelopmentAggregate());
    const ready = selectNextReadyTask(aggregate)!;
    aggregate = moveTaskToVerifying(aggregate, ready.taskRunId, "missing");
    const execution = completeTask(aggregate, {
      requestId: "complete-without-evidence",
      taskRunId: ready.taskRunId,
      evidenceIds: ["missing-evidence"],
      completedAt: at,
    });

    expect(execution.result).toMatchObject({
      accepted: false,
      reason: "evidence_missing",
    });
    expect(execution.aggregate.taskRuns[ready.taskRunId]?.status).toBe(
      "verifying",
    );
  });

  it("rejects passing Evidence assembled from different Workspace states", () => {
    let aggregate = start(newDevelopmentAggregate());
    aggregate = completeReadyTask(aggregate, "workspace-foundation").aggregate;
    const ready = selectNextReadyTask(aggregate)!;
    aggregate = moveTaskToVerifying(
      aggregate,
      ready.taskRunId,
      "workspace-primary",
    );
    const task = aggregate.taskRuns[ready.taskRunId]!;
    const definition = aggregate.executionPlan.tasks.find(
      ({ id }) => id === task.executionTaskId,
    )!;
    const evidenceIds: string[] = [];
    for (const [index, step] of definition.verificationSteps.entries()) {
      const evidenceId = `evidence-mixed-workspace-${index}`;
      evidenceIds.push(evidenceId);
      aggregate = recordTaskEvidence(aggregate, {
        requestId: `record-mixed-workspace-${index}`,
        evidence: {
          evidenceId,
          developmentRunId: aggregate.run.developmentRunId,
          taskRunId: task.taskRunId,
          verificationStepId: step.id,
          taskDefinitionHash: task.taskDefinitionHash,
          modelSnapshotId: task.modelSnapshotId!,
          type: evidenceType(step.evidenceType),
          producer: "verification_runner",
          artifactId: `artifact-mixed-${index}`,
          artifactHash: "a".repeat(64),
          patchJournalEntryId: "journal-mixed",
          commandResultHash: "b".repeat(64),
          exitCode: 0,
          errorCategory: "none",
          summary: "Individually passing Evidence",
          workspaceHash: `${index + 1}`.repeat(64),
          outcome: "passed",
          producedAt: at,
        },
      }).aggregate;
    }

    const completion = completeTask(aggregate, {
      requestId: "complete-mixed-workspace",
      taskRunId: task.taskRunId,
      evidenceIds,
      completedAt: at,
    });
    expect(completion.result).toMatchObject({
      accepted: false,
      reason: "evidence_missing",
    });
    expect(completion.aggregate.taskRuns[task.taskRunId]?.status).toBe(
      "verifying",
    );
  });

  it("creates a distinct Repair Agent Run and Patch Set from failed Evidence", () => {
    let aggregate = start(newDevelopmentAggregate());
    const ready = selectNextReadyTask(aggregate)!;
    aggregate = moveTaskToVerifying(aggregate, ready.taskRunId, "repair-domain");
    const task = aggregate.taskRuns[ready.taskRunId]!;
    const definition = aggregate.executionPlan.tasks.find(
      ({ id }) => id === task.executionTaskId,
    )!;
    const step = definition.verificationSteps[0]!;
    const failedEvidence = {
      evidenceId: "repair-failure-domain",
      developmentRunId: aggregate.run.developmentRunId,
      taskRunId: task.taskRunId,
      verificationStepId: step.id,
      taskDefinitionHash: task.taskDefinitionHash,
      modelSnapshotId: task.modelSnapshotId!,
      type: evidenceType(step.evidenceType),
      producer: "verification_runner" as const,
      artifactId: "repair-artifact-domain",
      artifactHash: "a".repeat(64),
      patchJournalEntryId: "repair-journal-domain",
      commandResultHash: "b".repeat(64),
      exitCode: 1,
      errorCategory: "verification_failed" as const,
      summary: "Tests failed",
      workspaceHash: "c".repeat(64),
      outcome: "failed" as const,
      producedAt: at,
    };
    aggregate = recordTaskEvidence(aggregate, {
      requestId: "record-repair-failure-domain",
      evidence: failedEvidence,
    }).aggregate;
    const attempt = {
      repairAttemptId: "repair-attempt-domain",
      attemptNumber: 1,
      agentRunId: "repair-agent-domain",
      modelSnapshotId: "repair-model-domain",
      patchSetId: "repair-patch-domain",
      failureEvidenceId: failedEvidence.evidenceId,
      failureFingerprint: contentHash([
        failedEvidence.verificationStepId,
        failedEvidence.errorCategory,
        failedEvidence.artifactHash,
        failedEvidence.summary,
      ]),
      errorCategory: failedEvidence.errorCategory,
      status: "proposed" as const,
      createdAt: at,
    };
    const command = {
      requestId: "start-repair-attempt-domain",
      taskRunId: task.taskRunId,
      maxAttempts: 2,
      attempt,
      begunAt: at,
    };
    const begun = beginRepair(aggregate, command);
    const replay = beginRepair(begun.aggregate, command);

    expect(begun.result.accepted).toBe(true);
    expect(begun.aggregate.taskRuns[task.taskRunId]).toMatchObject({
      status: "repairing",
      modelSnapshotId: "repair-model-domain",
      agentRunIds: expect.arrayContaining(["repair-agent-domain"]),
    });
    expect(begun.aggregate.agentRuns["repair-agent-domain"]).toMatchObject({
      purpose: "repair",
      status: "running",
    });
    expect(begun.aggregate.repairHistory).toEqual([attempt]);
    expect(replay.aggregate.repairHistory).toHaveLength(1);

    const patchRecorded = recordRepairAttemptOutcome(begun.aggregate, {
      requestId: "record-repair-patch-domain",
      taskRunId: task.taskRunId,
      repairAttemptId: attempt.repairAttemptId,
      status: "patch_applied",
      completedAt: at,
    });
    expect(patchRecorded.aggregate.repairHistory[0]?.status).toBe(
      "patch_applied",
    );

    const stopped = requireDevelopmentUserAction(patchRecorded.aggregate, {
      requestId: "repair-budget-exhausted-domain",
      taskRunId: task.taskRunId,
      reason: "repair_budget_exhausted",
      requiredAt: at,
    });
    expect(stopped.aggregate.run.status).toBe("needs_user_action");
    expect(stopped.aggregate.taskRuns[task.taskRunId]?.status).toBe("repairing");
  });

  it("requires a user to confirm a gate and keeps Gate commands idempotent", () => {
    let aggregate = start(newDevelopmentAggregate(executionContentWithGate()));
    aggregate = completeReadyTask(aggregate, "foundation").aggregate;
    const phaseRunId = aggregate.run.currentPhaseRunId!;
    expect(aggregate.run.status).toBe("awaiting_user_gate");

    const modelAttempt = confirmPhaseGate(aggregate, {
      requestId: "gate-model-attempt",
      decisionId: "decision-model",
      phaseRunId,
      userGateId: "gate-foundation",
      actorType: "model",
      actorId: "model-agent",
      confirmedAt: at,
    });
    expect(modelAttempt.result.reason).toBe("user_actor_required");
    expect(modelAttempt.aggregate.gateHistory).toHaveLength(0);

    const command = {
      requestId: "gate-user-confirmation",
      decisionId: "decision-user",
      phaseRunId,
      userGateId: "gate-foundation",
      actorType: "user" as const,
      actorId: "user-1",
      confirmedAt: at,
    };
    const accepted = confirmPhaseGate(modelAttempt.aggregate, command);
    const replay = confirmPhaseGate(accepted.aggregate, command);
    expect(accepted.result.accepted).toBe(true);
    expect(accepted.aggregate.gateHistory).toHaveLength(1);
    expect(selectNextReadyTask(accepted.aggregate)?.executionTaskId).toBe(
      "task-primary-workflow",
    );
    expect(replay.aggregate.gateHistory).toHaveLength(1);
    expect(replay.result).toEqual(accepted.result);
  });

  it("completes each Task and the Run exactly once under command replay", () => {
    let aggregate = start(newDevelopmentAggregate());
    const first = completeReadyTask(aggregate, "first");
    aggregate = first.aggregate;
    const beforeReplay = aggregate.transitionHistory.length;
    const replay = completeTask(aggregate, {
      requestId: first.completeRequestId,
      taskRunId: first.taskRunId,
      evidenceIds: first.evidenceIds,
      completedAt: at,
    });
    expect(replay.aggregate.transitionHistory).toHaveLength(beforeReplay);

    aggregate = completeReadyTask(replay.aggregate, "second").aggregate;
    expect(aggregate.run.status).toBe("completed");
    expect(
      aggregate.transitionHistory.filter(
        ({ entityType, toStatus }) =>
          entityType === "development_run" && toStatus === "completed",
      ),
    ).toHaveLength(1);

    const secondStart = startDevelopmentRun(aggregate, {
      requestId: "start-after-complete",
      startedAt: at,
    });
    expect(secondStart.result.reason).toBe("invalid_status");
    expect(
      secondStart.aggregate.transitionHistory.filter(
        ({ entityType, toStatus }) =>
          entityType === "development_run" && toStatus === "completed",
      ),
    ).toHaveLength(1);
  });
});

describe("development invalidation", () => {
  it("makes the whole Run stale after a Project Spec revision", () => {
    const aggregate = start(newDevelopmentAggregate());
    const execution = markPlanningRevision(aggregate, {
      requestId: "revise-spec",
      invalidationIdPrefix: "invalidate-spec",
      subjectType: "project_spec",
      newVersionId: "spec-v2",
      affectedTaskIds: [],
      revisedAt: at,
    });

    expect(execution.aggregate.run.status).toBe("stale");
    expect(Object.values(execution.aggregate.taskRuns).every(({ status }) => status === "stale")).toBe(true);
    expect(execution.aggregate.invalidationHistory).toHaveLength(3);
  });

  it("only invalidates affected eligibility for a downstream design revision", () => {
    const aggregate = start(newDevelopmentAggregate());
    const execution = markPlanningRevision(aggregate, {
      requestId: "revise-design",
      invalidationIdPrefix: "invalidate-design",
      subjectType: "technical_design",
      newVersionId: "design-v2",
      affectedTaskIds: ["task-primary-workflow"],
      revisedAt: at,
    });
    const byExecutionId = Object.fromEntries(
      Object.values(execution.aggregate.taskRuns).map((task) => [
        task.executionTaskId,
        task.status,
      ]),
    );
    expect(byExecutionId).toEqual({
      "task-foundation": "ready",
      "task-primary-workflow": "stale",
    });
    expect(execution.aggregate.run.status).toBe("stale");
  });

  it("reruns with a new immutable model snapshot and invalidates downstream evidence", () => {
    let aggregate = start(newDevelopmentAggregate(executionContentWithGate()));
    const first = completeReadyTask(aggregate, "rerun-foundation");
    aggregate = first.aggregate;
    aggregate = confirmPhaseGate(aggregate, {
      requestId: "rerun-gate",
      decisionId: "rerun-gate-decision",
      phaseRunId: aggregate.run.currentPhaseRunId!,
      userGateId: "gate-foundation",
      actorType: "user",
      actorId: "user-1",
      confirmedAt: at,
    }).aggregate;
    aggregate = completeReadyTask(aggregate, "rerun-primary").aggregate;
    expect(aggregate.run.status).toBe("completed");

    const rerun = rerunTaskWithModel(aggregate, {
      requestId: "rerun-with-model-2",
      invalidationIdPrefix: "invalidate-model-2",
      taskRunId: first.taskRunId,
      newAgentRunId: "agent-model-2",
      newModelSnapshotId: "model-snapshot-2",
      requestedAt: at,
    });
    const root = rerun.aggregate.taskRuns[first.taskRunId]!;
    const downstream = Object.values(rerun.aggregate.taskRuns).find(
      ({ executionTaskId }) => executionTaskId === "task-primary-workflow",
    )!;

    expect(rerun.result.accepted).toBe(true);
    expect(rerun.aggregate.run.status).toBe("running");
    expect(rerun.aggregate.run.completedAt).toBeUndefined();
    expect(root).toMatchObject({
      status: "assembling_context",
      modelSnapshotId: "model-snapshot-2",
      evidenceIds: [],
    });
    expect(downstream).toMatchObject({ status: "pending", evidenceIds: [] });
    expect(rerun.aggregate.agentRuns["agent-model-2"]).toMatchObject({
      status: "ready",
      modelSnapshotId: "model-snapshot-2",
    });
    expect(
      Object.values(rerun.aggregate.agentRuns)
        .filter(({ agentRunId }) => agentRunId !== "agent-model-2")
        .every(({ status }) => status === "stale"),
    ).toBe(true);
    expect(
      rerun.aggregate.invalidationHistory.filter(
        ({ targetType }) => targetType === "evidence",
      ),
    ).toHaveLength(3);
    expect(
      rerun.aggregate.invalidationHistory.some(
        ({ targetType }) => targetType === "gate",
      ),
    ).toBe(true);
    expect(rerun.aggregate.evidenceHistory).toHaveLength(3);
    expect(rerun.aggregate.gateHistory).toHaveLength(1);
  });
});
