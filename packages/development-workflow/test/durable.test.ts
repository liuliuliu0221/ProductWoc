import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DevelopmentCheckpointConflictError,
  FileDevelopmentCheckpointStore,
  InMemoryDevelopmentCheckpointStore,
} from "@product-woc/development-adapters";
import {
  beginTask,
  confirmPhaseGate,
  selectNextReadyTask,
  startDevelopmentRun,
  transitionTask,
  type DevelopmentAggregate,
} from "@product-woc/development-domain";

import {
  controlDurableDevelopmentRun,
  executeDevelopmentCheckpointCommand,
  initializeDevelopmentCheckpoint,
  parseDurableDevelopmentCheckpoint,
  prepareDevelopmentOperation,
  publishPendingDevelopmentEvents,
  recoverDevelopmentCheckpoint,
  type DurableDevelopmentCheckpoint,
} from "../src/index.js";
import { durableAggregateFixture, durableAt } from "./durable-fixtures.js";

const workspaceBefore = "1".repeat(64);
const workspaceAfter = "2".repeat(64);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function runningAggregate(): DevelopmentAggregate {
  return startDevelopmentRun(durableAggregateFixture().aggregate, {
    requestId: "domain-start-1",
    startedAt: durableAt,
  }).aggregate;
}

function taskAt(status: "applying_patch" | "verifying"): {
  aggregate: DevelopmentAggregate;
  taskRunId: string;
} {
  let aggregate = runningAggregate();
  const task = selectNextReadyTask(aggregate);
  if (!task) throw new Error("fixture task missing");
  aggregate = beginTask(aggregate, {
    requestId: "domain-begin-1",
    taskRunId: task.taskRunId,
    agentRunId: "agent-durable-1",
    modelSnapshotId: "model-durable-1",
    begunAt: durableAt,
  }).aggregate;
  aggregate = transitionTask(aggregate, {
    requestId: "domain-generating-1",
    taskRunId: task.taskRunId,
    toStatus: "generating_change",
    transitionedAt: durableAt,
  }).aggregate;
  aggregate = transitionTask(aggregate, {
    requestId: "domain-applying-1",
    taskRunId: task.taskRunId,
    toStatus: "applying_patch",
    transitionedAt: durableAt,
  }).aggregate;
  if (status === "verifying") {
    aggregate = transitionTask(aggregate, {
      requestId: "domain-verifying-1",
      taskRunId: task.taskRunId,
      toStatus: "verifying",
      transitionedAt: durableAt,
    }).aggregate;
  }
  return { aggregate, taskRunId: task.taskRunId };
}

function store(): InMemoryDevelopmentCheckpointStore<DurableDevelopmentCheckpoint> {
  return new InMemoryDevelopmentCheckpointStore(parseDurableDevelopmentCheckpoint);
}

function artifacts(runId: string, taskRunId: string) {
  const modelSnapshots = [{
    snapshotId: "model-durable-1",
    routeRequestId: "route-durable-1",
    agentRunId: "agent-durable-1",
    policyId: "policy-durable-1",
    scope: "development.implementation" as const,
    selectionSource: "application_default" as const,
    profile: {
      profileId: "deterministic-local",
      providerType: "deterministic" as const,
      model: "fixture-v1",
      temperature: 0,
      maxOutputTokens: 4096,
      capabilities: { structuredOutput: true, toolCalling: false, vision: false, localOnly: true },
    },
    policyHash: "3".repeat(64),
    profileHash: "4".repeat(64),
    configurationHash: "5".repeat(64),
    promptVersion: "1.0.0",
    toolPolicyVersion: "1.0.0",
    contextHash: "6".repeat(64),
    createdAt: durableAt,
  }];
  const contextSnapshots = [{
    contextSnapshotId: "context-durable-1",
    developmentRunId: runId,
    taskRunId,
    agentRunId: "agent-durable-1",
    executionTaskId: "task-foundation",
    taskDefinitionHash: "7".repeat(64),
    projectSpecVersionId: "spec-v1",
    technicalDesignVersionId: "design-v1",
    executionPlanVersionId: "plan-v1",
    allowedWritePaths: ["src/**"],
    blocks: [{
      blockId: "block-durable-1",
      kind: "execution_task" as const,
      sourceId: "task-foundation",
      sourceHash: "8".repeat(64),
      content: "Untrusted task fixture",
      trust: "untrusted_reference" as const,
      instructionAuthority: "none" as const,
      inclusionReason: "Current task",
      redacted: true,
      truncated: false,
    }],
    sources: [{
      sourceId: "task-foundation",
      sourceHash: "8".repeat(64),
      kind: "execution_task" as const,
      includedBlockIds: ["block-durable-1"],
      redacted: true,
      truncated: false,
    }],
    excludedCategories: ["full_chat_history" as const],
    contextHash: "6".repeat(64),
    createdAt: durableAt,
  }];
  const patchJournal = [{
    journalEntryId: "journal-durable-1",
    patchSetId: "patch-durable-1",
    proposalId: "proposal-durable-1",
    proposalHash: "9".repeat(64),
    idempotencyKey: "apply-durable-1",
    developmentRunId: runId,
    taskRunId,
    agentRunId: "agent-durable-1",
    contextSnapshotId: "context-durable-1",
    modelSnapshotId: "model-durable-1",
    status: "applied" as const,
    operations: [],
    workspaceManifestBeforeHash: workspaceBefore,
    workspaceManifestAfterHash: workspaceAfter,
    diffHash: "a".repeat(64),
    toolPolicyVersion: "1.0.0",
    rollbackAvailable: true,
    appliedAt: durableAt,
  }];
  const evidenceManifests = [{
    manifestId: "manifest-durable-1",
    developmentRunId: runId,
    taskRunId,
    taskDefinitionHash: "7".repeat(64),
    modelSnapshotId: "model-durable-1",
    patchJournalEntryId: "journal-durable-1",
    workspaceHash: workspaceAfter,
    evidenceIds: ["evidence-durable-1"],
    requiredVerificationStepIds: ["verify-durable-1"],
    passedRequiredStepIds: ["verify-durable-1"],
    status: "passed" as const,
    manifestHash: "b".repeat(64),
    createdAt: durableAt,
  }];
  const verificationArtifacts = [{
    artifactId: "artifact-durable-1",
    developmentRunId: runId,
    taskRunId,
    verificationStepId: "verify-durable-1",
    commandRequestId: "command-durable-1",
    source: "command_output" as const,
    content: "passed",
    contentHash: "c".repeat(64),
    byteLength: 6,
    truncated: false,
    redacted: true as const,
    createdAt: durableAt,
  }];
  const commandResults = [{
    executed: true,
    decision: {
      decisionId: "decision-durable-1",
      requestId: "command-durable-1",
      policyVersion: "1.0.0",
      operation: "command" as const,
      disposition: "allowed" as const,
      reason: "approved_template" as const,
      decidedAt: durableAt,
    },
    event: {
      eventId: "tool-event-durable-1",
      requestId: "command-durable-1",
      decisionId: "decision-durable-1",
      operation: "command" as const,
      disposition: "allowed" as const,
      redactedArguments: ["pnpm", "test"],
      resultSummary: "passed",
      occurredAt: durableAt,
    },
    failureCategory: "none" as const,
    exitCode: 0,
    stdout: "passed",
    stderr: "",
  }];
  return { modelSnapshots, contextSnapshots, patchJournal, evidenceManifests, verificationArtifacts, commandResults };
}

describe("durable Development workflow", () => {
  it("persists Run, model, context, Patch, Evidence and command results across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "product-woc-durable-workflow-"));
    directories.push(directory);
    const key = "workspace-1:development-run-durable";
    const { aggregate } = taskAt("verifying");
    const firstStore = new FileDevelopmentCheckpointStore(directory, parseDurableDevelopmentCheckpoint);
    const initialized = await initializeDevelopmentCheckpoint(firstStore, {
      key,
      requestId: "initialize-checkpoint-1",
      aggregate,
      workspaceHash: workspaceAfter,
      occurredAt: durableAt,
    });
    const taskRunId = aggregate.run.currentTaskRunId!;
    await executeDevelopmentCheckpointCommand(firstStore, {
      key,
      expectedRevision: initialized.revision,
      requestId: "persist-artifacts-1",
      commandKind: "verify",
      occurredAt: durableAt,
      mutate: (checkpoint) => ({
        aggregate: checkpoint.aggregate,
        safeBoundary: "verification_committed",
        result: { persisted: true },
        accepted: true,
        artifacts: artifacts(aggregate.run.developmentRunId, taskRunId),
      }),
    });

    const restartedStore = new FileDevelopmentCheckpointStore(directory, parseDurableDevelopmentCheckpoint);
    const restored = await restartedStore.load(key);
    expect(restored?.value.aggregate.run.developmentRunId).toBe(aggregate.run.developmentRunId);
    expect(restored?.value.modelSnapshots).toHaveLength(1);
    expect(restored?.value.contextSnapshots).toHaveLength(1);
    expect(restored?.value.patchJournal).toHaveLength(1);
    expect(restored?.value.evidenceManifests).toHaveLength(1);
    expect(restored?.value.verificationArtifacts).toHaveLength(1);
    expect(restored?.value.commandResults).toHaveLength(1);
  });

  it("finalizes a fully written Patch after restart without replaying the Patch", async () => {
    const checkpointStore = store();
    const { aggregate, taskRunId } = taskAt("applying_patch");
    const { envelope } = durableAggregateFixture();
    const initialized = await initializeDevelopmentCheckpoint(checkpointStore, {
      key: "run",
      requestId: "initialize-apply-1",
      aggregate,
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const preparedJournal = artifacts(
      aggregate.run.developmentRunId,
      taskRunId,
    ).patchJournal[0]!;
    const prepared = await prepareDevelopmentOperation(checkpointStore, {
      key: "run",
      expectedRevision: initialized.revision,
      operation: {
        requestId: "apply-side-effect-1",
        commandKind: "apply",
        taskRunId,
        operation: "applying_patch",
        beforeWorkspaceHash: workspaceBefore,
        expectedAfterWorkspaceHash: workspaceAfter,
        patchJournalEntryId: preparedJournal.journalEntryId,
        preparedPatchJournal: preparedJournal,
        startedAt: durableAt,
      },
    });
    const recovered = await recoverDevelopmentCheckpoint(checkpointStore, {
      key: "run",
      requestId: "recover-apply-1",
      expectedRevision: prepared.revision,
      currentEnvelope: envelope,
      actualWorkspaceHash: workspaceAfter,
      auditedAt: "2026-08-29T16:01:00.000Z",
    });
    expect(recovered.audit.disposition).toBe("finalize_patch");
    expect(recovered.checkpoint.pendingOperation).toBeUndefined();
    expect(recovered.checkpoint.patchJournal).toEqual([preparedJournal]);
    expect(recovered.checkpoint.aggregate.taskRuns[taskRunId]?.status).toBe("verifying");
  });

  it("never replays an uncertain Patch and blocks Workspace or Planning drift", async () => {
    const { aggregate, taskRunId } = taskAt("applying_patch");
    const { envelope } = durableAggregateFixture();
    const uncertainStore = store();
    const initialized = await initializeDevelopmentCheckpoint(uncertainStore, {
      key: "uncertain",
      requestId: "initialize-uncertain-1",
      aggregate,
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const preparedJournal = artifacts(
      aggregate.run.developmentRunId,
      taskRunId,
    ).patchJournal[0]!;
    const prepared = await prepareDevelopmentOperation(uncertainStore, {
      key: "uncertain",
      expectedRevision: initialized.revision,
      operation: {
        requestId: "apply-uncertain-1",
        commandKind: "apply",
        taskRunId,
        operation: "applying_patch",
        beforeWorkspaceHash: workspaceBefore,
        expectedAfterWorkspaceHash: workspaceAfter,
        patchJournalEntryId: preparedJournal.journalEntryId,
        preparedPatchJournal: preparedJournal,
        startedAt: durableAt,
      },
    });
    const uncertain = await recoverDevelopmentCheckpoint(uncertainStore, {
      key: "uncertain",
      requestId: "recover-uncertain-1",
      expectedRevision: prepared.revision,
      currentEnvelope: envelope,
      actualWorkspaceHash: "3".repeat(64),
      auditedAt: "2026-08-29T16:01:00.000Z",
    });
    expect(uncertain.audit).toMatchObject({ reason: "uncertain_patch", disposition: "manual_review" });
    expect(uncertain.checkpoint.safeBoundary).toBe("recovery_required");
    expect(uncertain.checkpoint.aggregate.taskRuns[taskRunId]?.status).toBe("applying_patch");

    const staleStore = store();
    const stable = await initializeDevelopmentCheckpoint(staleStore, {
      key: "stale",
      requestId: "initialize-stale-1",
      aggregate: runningAggregate(),
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const stale = await recoverDevelopmentCheckpoint(staleStore, {
      key: "stale",
      requestId: "recover-stale-1",
      expectedRevision: stable.revision,
      currentEnvelope: { ...envelope, createdAt: "2026-08-29T16:02:00.000Z" },
      actualWorkspaceHash: workspaceBefore,
      auditedAt: "2026-08-29T16:02:00.000Z",
    });
    expect(stale.audit).toMatchObject({ reason: "planning_stale", disposition: "blocked" });

    const driftStore = store();
    const driftCheckpoint = await initializeDevelopmentCheckpoint(driftStore, {
      key: "drift",
      requestId: "initialize-drift-1",
      aggregate: runningAggregate(),
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const drift = await recoverDevelopmentCheckpoint(driftStore, {
      key: "drift",
      requestId: "recover-drift-1",
      expectedRevision: driftCheckpoint.revision,
      currentEnvelope: envelope,
      actualWorkspaceHash: "4".repeat(64),
      auditedAt: "2026-08-29T16:03:00.000Z",
    });
    expect(drift.audit).toMatchObject({ reason: "workspace_drift", disposition: "blocked" });
  });

  it("marks interrupted verification replayable but interrupted Repair manual", async () => {
    const { envelope } = durableAggregateFixture();
    const verifying = taskAt("verifying");
    const verificationStore = store();
    const initialized = await initializeDevelopmentCheckpoint(verificationStore, {
      key: "verify",
      requestId: "initialize-verify-1",
      aggregate: verifying.aggregate,
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const prepared = await prepareDevelopmentOperation(verificationStore, {
      key: "verify",
      expectedRevision: initialized.revision,
      operation: {
        requestId: "verify-side-effect-1",
        commandKind: "verify",
        taskRunId: verifying.taskRunId,
        operation: "verifying",
        beforeWorkspaceHash: workspaceBefore,
        startedAt: durableAt,
      },
    });
    const recovered = await recoverDevelopmentCheckpoint(verificationStore, {
      key: "verify",
      requestId: "recover-verify-1",
      expectedRevision: prepared.revision,
      currentEnvelope: envelope,
      actualWorkspaceHash: workspaceBefore,
      auditedAt: "2026-08-29T16:01:00.000Z",
    });
    expect(recovered.audit).toMatchObject({
      reason: "verification_interrupted",
      disposition: "resume_verification",
    });
    expect(recovered.checkpoint.pendingOperation?.requestId).toBe("verify-side-effect-1");

    const repairStore = store();
    const repairTask = verifying.aggregate.taskRuns[verifying.taskRunId]!;
    const repairAggregate: DevelopmentAggregate = {
      ...verifying.aggregate,
      taskRuns: {
        ...verifying.aggregate.taskRuns,
        [verifying.taskRunId]: { ...repairTask, status: "repairing" },
      },
    };
    const repairInitialized = await initializeDevelopmentCheckpoint(repairStore, {
      key: "repair",
      requestId: "initialize-repair-1",
      aggregate: repairAggregate,
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const repairPrepared = await prepareDevelopmentOperation(repairStore, {
      key: "repair",
      expectedRevision: repairInitialized.revision,
      operation: {
        requestId: "repair-provider-1",
        commandKind: "repair",
        taskRunId: verifying.taskRunId,
        operation: "repairing",
        beforeWorkspaceHash: workspaceBefore,
        startedAt: durableAt,
      },
    });
    const repairRecovered = await recoverDevelopmentCheckpoint(repairStore, {
      key: "repair",
      requestId: "recover-repair-1",
      expectedRevision: repairPrepared.revision,
      currentEnvelope: envelope,
      actualWorkspaceHash: workspaceBefore,
      auditedAt: "2026-08-29T16:02:00.000Z",
    });
    expect(repairRecovered.audit).toMatchObject({
      reason: "repair_interrupted",
      disposition: "manual_review",
    });
  });

  it("keeps failed Outbox publication pending and retries after restart", async () => {
    const checkpointStore = store();
    await initializeDevelopmentCheckpoint(checkpointStore, {
      key: "outbox",
      requestId: "initialize-outbox-1",
      aggregate: runningAggregate(),
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    let failedCalls = 0;
    await expect(
      publishPendingDevelopmentEvents(
        checkpointStore,
        "outbox",
        { publish: async () => { failedCalls += 1; throw new Error("offline"); } },
        () => durableAt,
      ),
    ).rejects.toThrow("offline");
    expect(failedCalls).toBe(1);
    expect(await checkpointStore.pendingOutbox("outbox")).toHaveLength(1);

    const delivered: string[] = [];
    await publishPendingDevelopmentEvents(
      checkpointStore,
      "outbox",
      { publish: async (event) => { delivered.push(event.eventId); } },
      () => "2026-08-29T16:03:00.000Z",
    );
    expect(delivered).toHaveLength(1);
    expect(await checkpointStore.pendingOutbox("outbox")).toEqual([]);
  });

  it("makes Pause/Resume/Cancel idempotent and rejects stale revisions", async () => {
    const checkpointStore = store();
    const initialized = await initializeDevelopmentCheckpoint(checkpointStore, {
      key: "controls",
      requestId: "initialize-controls-1",
      aggregate: runningAggregate(),
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const paused = await controlDurableDevelopmentRun(checkpointStore, {
      key: "controls",
      expectedRevision: initialized.revision,
      command: {
        requestId: "pause-controls-1",
        action: "pause",
        actorId: "local-user",
        reason: "Pause safely",
        occurredAt: durableAt,
      },
    });
    const resumed = await controlDurableDevelopmentRun(checkpointStore, {
      key: "controls",
      expectedRevision: paused.checkpointRevision,
      command: {
        requestId: "resume-controls-1",
        action: "resume",
        actorId: "local-user",
        reason: "Resume safely",
        occurredAt: durableAt,
      },
    });
    const replay = await controlDurableDevelopmentRun(checkpointStore, {
      key: "controls",
      expectedRevision: initialized.revision,
      command: {
        requestId: "resume-controls-1",
        action: "resume",
        actorId: "local-user",
        reason: "Resume safely",
        occurredAt: durableAt,
      },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.checkpointRevision).toBe(resumed.checkpointRevision);

    await expect(
      controlDurableDevelopmentRun(checkpointStore, {
        key: "controls",
        expectedRevision: initialized.revision,
        command: {
          requestId: "cancel-controls-stale",
          action: "cancel",
          actorId: "local-user",
          reason: "Stale caller",
          occurredAt: durableAt,
        },
      }),
    ).rejects.toBeInstanceOf(DevelopmentCheckpointConflictError);
    const cancelled = await controlDurableDevelopmentRun(checkpointStore, {
      key: "controls",
      expectedRevision: resumed.checkpointRevision,
      command: {
        requestId: "cancel-controls-1",
        action: "cancel",
        actorId: "local-user",
        reason: "Stop safely",
        occurredAt: durableAt,
      },
    });
    expect(cancelled.checkpoint.aggregate.run.status).toBe("cancelled");
  });

  it("records and replays an out-of-order Gate rejection without a second mutation", async () => {
    const checkpointStore = store();
    const initialized = await initializeDevelopmentCheckpoint(checkpointStore, {
      key: "gate",
      requestId: "initialize-gate-1",
      aggregate: runningAggregate(),
      workspaceHash: workspaceBefore,
      occurredAt: durableAt,
    });
    const executeGate = (expectedRevision: number) =>
      executeDevelopmentCheckpointCommand(checkpointStore, {
        key: "gate",
        expectedRevision,
        requestId: "gate-out-of-order-1",
        commandKind: "gate",
        occurredAt: durableAt,
        mutate: (checkpoint) => {
          const execution = confirmPhaseGate(checkpoint.aggregate, {
            requestId: "gate-out-of-order-domain-1",
            decisionId: "gate-out-of-order-decision-1",
            phaseRunId: checkpoint.aggregate.run.currentPhaseRunId!,
            userGateId: "gate-not-ready",
            actorType: "user",
            actorId: "local-user",
            confirmedAt: durableAt,
          });
          return {
            aggregate: execution.aggregate,
            safeBoundary: "task_ready" as const,
            result: execution.result,
            accepted: execution.result.accepted,
          };
        },
      });
    const rejected = await executeGate(initialized.revision);
    expect(rejected.result).toMatchObject({ accepted: false });
    const replayed = await executeGate(initialized.revision);
    expect(replayed.replayed).toBe(true);
    expect(replayed.checkpointRevision).toBe(rejected.checkpointRevision);
  });
});
