import {
  type DevelopmentCheckpointStore,
  FileDevelopmentCheckpointStore,
} from "@product-woc/development-adapters";
import {
  modelStageScopeSchema,
  type DevelopmentControlCommand,
  type DevelopmentRunStatus,
  type ModelAvailabilityStatus,
  type ModelAvailabilityView,
  type TaskRunStatus,
} from "@product-woc/development-contracts";
import { confirmPhaseGate } from "@product-woc/development-domain";
import {
  controlDurableDevelopmentRun,
  executeDevelopmentCheckpointCommand,
  parseDurableDevelopmentCheckpoint,
  recoverDevelopmentCheckpoint,
  type DurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";
import type { DevelopmentStartEnvelope } from "@product-woc/planning-contracts";
import type { RuntimeConfigurationState } from "@product-woc/runtime-config";

import {
  defaultModelPolicy,
  FileDevelopmentModelPolicyStore,
  InMemoryDevelopmentModelPolicyStore,
  type DevelopmentModelPolicyStore,
  type StoredModelPolicy,
} from "./model-policy-store.js";

export type DevelopmentLabRole = "viewer" | "editor";

export interface DevelopmentLabActor {
  workspaceId: string;
  actorId: string;
  role: DevelopmentLabRole;
}

export interface DevelopmentWriteBinding {
  idempotencyKey: string;
  checkpointRevision: number;
  workspaceHash: string;
}

export interface DevelopmentLabActionPort {
  verify?(input: {
    checkpoint: DurableDevelopmentCheckpoint;
    requestId: string;
    occurredAt: string;
  }): Promise<{
    aggregate: DurableDevelopmentCheckpoint["aggregate"];
    artifacts: {
      evidenceManifests?: DurableDevelopmentCheckpoint["evidenceManifests"];
      verificationArtifacts?: DurableDevelopmentCheckpoint["verificationArtifacts"];
      commandResults?: DurableDevelopmentCheckpoint["commandResults"];
    };
    workspaceHash: string;
  }>;
  rollback?(input: {
    checkpoint: DurableDevelopmentCheckpoint;
    requestId: string;
    actorId: string;
    occurredAt: string;
  }): Promise<{
    aggregate: DurableDevelopmentCheckpoint["aggregate"];
    workspaceHash: string;
  }>;
  retry?(input: {
    checkpoint: DurableDevelopmentCheckpoint;
    requestId: string;
    occurredAt: string;
  }): Promise<DurableDevelopmentCheckpoint["aggregate"]>;
}

export interface DevelopmentPageViewModel {
  workspaceId: string;
  projectId: string;
  developmentRunId: string;
  status: DevelopmentRunStatus;
  statusLabel: string;
  checkpointRevision: number;
  aggregateRevision: number;
  safeBoundary: DurableDevelopmentCheckpoint["safeBoundary"];
  workspaceHash: string;
  envelope: {
    envelopeId: string;
    envelopeHash: string;
    planningWorkflowRunId: string;
    executionPlanVersionId: string;
    valid: boolean;
  };
  phases: readonly {
    phaseRunId: string;
    executionPhaseId: string;
    title: string;
    status: string;
    tasks: readonly {
      taskRunId: string;
      executionTaskId: string;
      title: string;
      status: TaskRunStatus;
      dependsOn: readonly string[];
      requirementIds: readonly string[];
      acceptanceCriterionIds: readonly string[];
      designItemIds: readonly string[];
      evidenceCount: number;
    }[];
  }[];
  currentTask?: {
    taskRunId: string;
    title: string;
    status: TaskRunStatus;
    dependencies: readonly string[];
    requirementIds: readonly string[];
    acceptanceCriterionIds: readonly string[];
    designItemIds: readonly string[];
  };
  models: {
    configurationAuthority: "developer_operator";
    webEditable: false;
    status: ModelAvailabilityStatus;
    stages: ModelAvailabilityView["stages"];
    snapshots: readonly {
      snapshotId: string;
      scope: string;
      model: string;
      providerType: string;
      selectionSource: string;
      status: "configured";
    }[];
  };
  contexts: readonly {
    contextSnapshotId: string;
    taskRunId: string;
    sourceCount: number;
    allowedWritePaths: readonly string[];
    contextHash: string;
  }[];
  patches: readonly {
    journalEntryId: string;
    taskRunId: string;
    status: string;
    files: readonly {
      path: string;
      operation: string;
      beforeHash?: string;
      afterHash?: string;
    }[];
    diffHash: string;
    risk: "normal" | "requires_review";
  }[];
  verification: {
    manifests: DurableDevelopmentCheckpoint["evidenceManifests"];
    evidence: DurableDevelopmentCheckpoint["aggregate"]["evidenceHistory"];
    logs: readonly {
      artifactId: string;
      taskRunId: string;
      verificationStepId: string;
      content: string;
      truncated: boolean;
    }[];
  };
  repairs: DurableDevelopmentCheckpoint["aggregate"]["repairHistory"];
  blockers: readonly {
    kind: "stale" | "workspace_drift" | "manual_review" | "needs_user_action";
    title: string;
    detail: string;
  }[];
  permissions: {
    canPause: boolean;
    canResume: boolean;
    canRetry: boolean;
    canVerify: boolean;
    canRollback: boolean;
    canCancel: boolean;
    canGate: boolean;
  };
  actions: readonly ["pause", "resume", "retry", "verify", "rollback", "cancel", "gate"];
}

const statusLabels: Record<DevelopmentRunStatus, string> = {
  validating_input: "正在校验规划输入",
  ready: "准备开始开发",
  running: "开发进行中",
  awaiting_user_gate: "等待阶段确认",
  paused: "已暂停",
  needs_user_action: "需要人工处理",
  stale: "规划输入已失效",
  completed: "开发已完成",
  failed: "开发失败",
  cancelled: "开发已取消",
};

export class DevelopmentLabError extends Error {
  public constructor(
    public readonly code: "forbidden" | "not_found" | "conflict" | "invalid_request" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DevelopmentLabError";
  }
}

export function developmentCheckpointKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}:development`;
}

function assertWorkspace(actor: DevelopmentLabActor, workspaceId: string): void {
  if (actor.workspaceId !== workspaceId) {
    throw new DevelopmentLabError("forbidden", "Cross-workspace access is not allowed");
  }
}

function assertEditor(actor: DevelopmentLabActor): void {
  if (actor.role !== "editor") {
    throw new DevelopmentLabError("forbidden", "Editor role is required");
  }
}

function assertBinding(
  storedRevision: number,
  checkpoint: DurableDevelopmentCheckpoint,
  binding: DevelopmentWriteBinding,
): void {
  if (binding.checkpointRevision !== storedRevision) {
    throw new DevelopmentLabError("conflict", "Checkpoint Revision is stale");
  }
  if (binding.workspaceHash !== checkpoint.workspaceHash) {
    throw new DevelopmentLabError("conflict", "Workspace Hash is stale");
  }
  if (!binding.idempotencyKey.trim()) {
    throw new DevelopmentLabError("invalid_request", "Idempotency Key is required");
  }
}

function blockersFrom(checkpoint: DurableDevelopmentCheckpoint): DevelopmentPageViewModel["blockers"] {
  const blockers: Array<DevelopmentPageViewModel["blockers"][number]> = [];
  if (checkpoint.aggregate.run.status === "stale") {
    blockers.push({ kind: "stale", title: "规划已失效", detail: "重新确认规划 Envelope 后才能继续。" });
  }
  if (checkpoint.aggregate.run.status === "needs_user_action") {
    blockers.push({ kind: "needs_user_action", title: "需要人工处理", detail: "查看验证、Repair 或回滚冲突后选择处理路径。" });
  }
  const audit = checkpoint.recoveryAudits.at(-1);
  if (audit?.reason === "workspace_drift") {
    blockers.push({ kind: "workspace_drift", title: "Workspace 已漂移", detail: "当前文件 Hash 与最后安全边界不一致。" });
  }
  if (audit?.disposition === "manual_review") {
    blockers.push({ kind: "manual_review", title: "恢复需要人工核对", detail: `中断原因：${audit.reason}` });
  }
  return blockers;
}

export function developmentViewFrom(
  checkpointRevision: number,
  checkpointValue: DurableDevelopmentCheckpoint,
  actor: DevelopmentLabActor,
  actions: DevelopmentLabActionPort = {},
  modelPolicyValue?: StoredModelPolicy,
  modelAvailabilityValue?: ModelAvailabilityView,
): DevelopmentPageViewModel {
  const checkpoint = parseDurableDevelopmentCheckpoint(checkpointValue);
  assertWorkspace(actor, checkpoint.aggregate.input.workspaceId);
  const plan = checkpoint.aggregate.executionPlan;
  const currentTaskRunId = checkpoint.aggregate.run.currentTaskRunId;
  const currentTaskRun = currentTaskRunId
    ? checkpoint.aggregate.taskRuns[currentTaskRunId]
    : undefined;
  const currentTaskDefinition = currentTaskRun
    ? plan.tasks.find(({ id }) => id === currentTaskRun.executionTaskId)
    : undefined;
  const editable = actor.role === "editor";
  const runStatus = checkpoint.aggregate.run.status;
  const currentPatch = currentTaskRunId
    ? [...checkpoint.patchJournal].reverse().find(({ taskRunId }) => taskRunId === currentTaskRunId)
    : undefined;
  const modelPolicy = modelPolicyValue ?? defaultModelPolicy(
    checkpoint.aggregate.input.workspaceId,
    checkpoint.aggregate.input.projectId,
    checkpoint.createdAt,
  );
  const defaultProfileId =
    modelPolicy.policy.projectDefaultProfileId ??
    modelPolicy.policy.applicationDefaultProfileId;
  const fallbackModelStages = modelStageScopeSchema.options.map((scope) => {
    const override = modelPolicy.policy.stageOverrides.find(
      (candidate) => candidate.scope === scope,
    );
    const profile = modelPolicy.policy.profiles.find(
      ({ profileId }) => profileId === (override?.profileId ?? defaultProfileId),
    );
    if (!profile) {
      throw new DevelopmentLabError(
        "unavailable",
        `The operator model configuration cannot resolve ${scope}`,
      );
    }
    return {
      scope,
      providerType: profile.providerType,
      modelLabel: profile.model,
      selectionSource: override
        ? "stage_override" as const
        : "application_default" as const,
      status: profile.providerType === "deterministic"
        ? "test_mode" as const
        : "unavailable" as const,
    };
  });
  const modelStatuses = new Set(fallbackModelStages.map(({ status }) => status));
  const fallbackModelStatus: ModelAvailabilityStatus = modelStatuses.size === 1
    ? (fallbackModelStages[0]?.status ?? "unavailable")
    : "degraded";
  const modelAvailability = modelAvailabilityValue ?? {
    configurationAuthority: "developer_operator" as const,
    webEditable: false as const,
    status: fallbackModelStatus,
    stages: fallbackModelStages,
  };
  return {
    workspaceId: checkpoint.aggregate.input.workspaceId,
    projectId: checkpoint.aggregate.input.projectId,
    developmentRunId: checkpoint.developmentRunId,
    status: runStatus,
    statusLabel: statusLabels[runStatus],
    checkpointRevision,
    aggregateRevision: checkpoint.aggregate.run.revision,
    safeBoundary: checkpoint.safeBoundary,
    workspaceHash: checkpoint.workspaceHash,
    envelope: {
      envelopeId: checkpoint.aggregate.input.envelopeId,
      envelopeHash: checkpoint.aggregate.input.envelopeHash,
      planningWorkflowRunId: checkpoint.aggregate.input.planningWorkflowRunId,
      executionPlanVersionId: checkpoint.aggregate.input.executionPlanVersionId,
      valid: runStatus !== "stale",
    },
    phases: plan.phases.map((phase) => {
      const phaseRun = Object.values(checkpoint.aggregate.phaseRuns).find(
        ({ executionPhaseId }) => executionPhaseId === phase.id,
      );
      return {
        phaseRunId: phaseRun?.phaseRunId ?? phase.id,
        executionPhaseId: phase.id,
        title: phase.title,
        status: phaseRun?.status ?? "pending",
        tasks: phase.taskIds.flatMap((taskId) => {
          const definition = plan.tasks.find(({ id }) => id === taskId);
          const taskRun = Object.values(checkpoint.aggregate.taskRuns).find(
            ({ executionTaskId }) => executionTaskId === taskId,
          );
          return definition && taskRun
            ? [{
                taskRunId: taskRun.taskRunId,
                executionTaskId: definition.id,
                title: definition.title,
                status: taskRun.status,
                dependsOn: definition.dependsOn,
                requirementIds: definition.requirementIds,
                acceptanceCriterionIds: definition.acceptanceCriterionIds,
                designItemIds: definition.designItemIds,
                evidenceCount: taskRun.evidenceIds.length,
              }]
            : [];
        }),
      };
    }),
    ...(currentTaskRun && currentTaskDefinition
      ? {
          currentTask: {
            taskRunId: currentTaskRun.taskRunId,
            title: currentTaskDefinition.title,
            status: currentTaskRun.status,
            dependencies: currentTaskDefinition.dependsOn,
            requirementIds: currentTaskDefinition.requirementIds,
            acceptanceCriterionIds: currentTaskDefinition.acceptanceCriterionIds,
            designItemIds: currentTaskDefinition.designItemIds,
          },
        }
      : {}),
    models: {
      ...modelAvailability,
      snapshots: checkpoint.modelSnapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        scope: snapshot.scope,
        model: snapshot.profile.model,
        providerType: snapshot.profile.providerType,
        selectionSource: snapshot.selectionSource,
        status: "configured" as const,
      })),
    },
    contexts: checkpoint.contextSnapshots.map((context) => ({
      contextSnapshotId: context.contextSnapshotId,
      taskRunId: context.taskRunId,
      sourceCount: context.sources.length,
      allowedWritePaths: context.allowedWritePaths,
      contextHash: context.contextHash,
    })),
    patches: checkpoint.patchJournal.map((journal) => ({
      journalEntryId: journal.journalEntryId,
      taskRunId: journal.taskRunId,
      status: journal.status,
      files: journal.operations.map((operation) => ({
        path: operation.relativePath,
        operation: operation.operation,
        ...(operation.beforeHash ? { beforeHash: operation.beforeHash } : {}),
        ...(operation.afterHash ? { afterHash: operation.afterHash } : {}),
      })),
      diffHash: journal.diffHash,
      risk: journal.operations.some(({ operation }) => operation === "delete")
        ? "requires_review"
        : "normal",
    })),
    verification: {
      manifests: checkpoint.evidenceManifests,
      evidence: checkpoint.aggregate.evidenceHistory,
      logs: checkpoint.verificationArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        taskRunId: artifact.taskRunId,
        verificationStepId: artifact.verificationStepId,
        content: artifact.content,
        truncated: artifact.truncated,
      })),
    },
    repairs: checkpoint.aggregate.repairHistory,
    blockers: blockersFrom(checkpoint),
    permissions: {
      canPause: editable && runStatus === "running" && !checkpoint.pendingOperation,
      canResume: editable && runStatus === "paused" && !checkpoint.pendingOperation,
      canRetry: editable && Boolean(actions.retry) && ["needs_user_action", "paused"].includes(runStatus),
      canVerify: editable && Boolean(actions.verify) && currentTaskRun?.status === "verifying",
      canRollback: editable && Boolean(actions.rollback) && Boolean(currentPatch) && ["verifying", "repairing"].includes(currentTaskRun?.status ?? ""),
      canCancel: editable && !["completed", "cancelled", "failed"].includes(runStatus),
      canGate: editable && runStatus === "awaiting_user_gate",
    },
    actions: ["pause", "resume", "retry", "verify", "rollback", "cancel", "gate"],
  };
}

export class DevelopmentLabApplication {
  public constructor(
    private readonly store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
    private readonly actions: DevelopmentLabActionPort = {},
    private readonly modelPolicies: DevelopmentModelPolicyStore = new InMemoryDevelopmentModelPolicyStore(),
    private readonly runtimeConfiguration?: RuntimeConfigurationState,
  ) {}

  public static fileBacked(
    directory: string,
    actions: DevelopmentLabActionPort = {},
    modelPolicyDirectory = `${directory}-model-policies`,
    runtimeConfiguration?: RuntimeConfigurationState,
  ): DevelopmentLabApplication {
    return new DevelopmentLabApplication(
      new FileDevelopmentCheckpointStore(directory, parseDurableDevelopmentCheckpoint),
      actions,
      new FileDevelopmentModelPolicyStore(modelPolicyDirectory),
      runtimeConfiguration,
    );
  }

  private async modelPolicy(checkpoint: DurableDevelopmentCheckpoint): Promise<StoredModelPolicy> {
    const runtime = this.runtimeConfiguration;
    if (runtime?.config && runtime.configurationHash) {
      const timestamp = runtime.operatorSnapshot?.loadedAt ?? checkpoint.createdAt;
      return {
        schemaVersion: "1.0.0",
        workspaceId: checkpoint.aggregate.input.workspaceId,
        projectId: checkpoint.aggregate.input.projectId,
        revision: 0,
        policy: {
          policyId: `runtime:${runtime.configurationHash.slice(0, 48)}`,
          profiles: runtime.config.profiles,
          applicationDefaultProfileId: runtime.config.applicationDefaultProfileId,
          stageOverrides: runtime.config.stageOverrides,
          fallback: runtime.config.fallbackPolicy === "pause"
            ? "pause"
            : "explicit_profile",
          ...(runtime.config.fallbackProfileId
            ? { fallbackProfileId: runtime.config.fallbackProfileId }
            : {}),
          createdAt: timestamp,
        },
        processedRequests: {},
        updatedAt: timestamp,
      };
    }
    return await this.modelPolicies.load(
      checkpoint.aggregate.input.workspaceId,
      checkpoint.aggregate.input.projectId,
    ) ?? defaultModelPolicy(
      checkpoint.aggregate.input.workspaceId,
      checkpoint.aggregate.input.projectId,
      checkpoint.createdAt,
    );
  }

  private async view(
    checkpointRevision: number,
    checkpoint: DurableDevelopmentCheckpoint,
    actor: DevelopmentLabActor,
  ): Promise<DevelopmentPageViewModel> {
    return developmentViewFrom(
      checkpointRevision,
      checkpoint,
      actor,
      this.actions,
      await this.modelPolicy(checkpoint),
      this.runtimeConfiguration?.availability,
    );
  }

  private async loaded(workspaceId: string, projectId: string, actor: DevelopmentLabActor) {
    assertWorkspace(actor, workspaceId);
    const key = developmentCheckpointKey(workspaceId, projectId);
    const stored = await this.store.load(key);
    if (!stored) throw new DevelopmentLabError("not_found", "Development Checkpoint not found");
    return { key, stored, checkpoint: parseDurableDevelopmentCheckpoint(stored.value) };
  }

  public async get(workspaceId: string, projectId: string, actor: DevelopmentLabActor): Promise<DevelopmentPageViewModel> {
    const { stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    return this.view(stored.revision, checkpoint, actor);
  }

  public async control(
    workspaceId: string,
    projectId: string,
    action: DevelopmentControlCommand["action"],
    reason: string,
    binding: DevelopmentWriteBinding,
    actor: DevelopmentLabActor,
    occurredAt: string,
  ): Promise<DevelopmentPageViewModel> {
    assertEditor(actor);
    const { key, stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    assertBinding(stored.revision, checkpoint, binding);
    const outcome = await controlDurableDevelopmentRun(this.store, {
      key,
      expectedRevision: stored.revision,
      command: {
        requestId: binding.idempotencyKey,
        action,
        actorId: actor.actorId,
        reason,
        occurredAt,
      },
    });
    return this.view(outcome.checkpointRevision, outcome.checkpoint, actor);
  }

  public async gate(
    workspaceId: string,
    projectId: string,
    input: DevelopmentWriteBinding & { phaseRunId: string; userGateId: string },
    actor: DevelopmentLabActor,
    occurredAt: string,
  ): Promise<DevelopmentPageViewModel> {
    assertEditor(actor);
    const { key, stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    assertBinding(stored.revision, checkpoint, input);
    const outcome = await executeDevelopmentCheckpointCommand(this.store, {
      key,
      expectedRevision: stored.revision,
      requestId: input.idempotencyKey,
      commandKind: "gate",
      occurredAt,
      mutate: (current) => {
        const execution = confirmPhaseGate(current.aggregate, {
          requestId: `domain:${input.idempotencyKey}`,
          decisionId: `decision:${input.idempotencyKey}`,
          phaseRunId: input.phaseRunId,
          userGateId: input.userGateId,
          actorType: "user",
          actorId: actor.actorId,
          confirmedAt: occurredAt,
        });
        return {
          aggregate: execution.aggregate,
          safeBoundary: execution.result.accepted ? "gate_committed" : current.safeBoundary,
          result: execution.result,
          accepted: execution.result.accepted,
        };
      },
    });
    return this.view(outcome.checkpointRevision, outcome.checkpoint, actor);
  }

  public async recover(
    workspaceId: string,
    projectId: string,
    currentEnvelope: DevelopmentStartEnvelope,
    actualWorkspaceHash: string,
    binding: DevelopmentWriteBinding,
    actor: DevelopmentLabActor,
    occurredAt: string,
  ): Promise<DevelopmentPageViewModel> {
    assertEditor(actor);
    const { key, stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    assertBinding(stored.revision, checkpoint, binding);
    const outcome = await recoverDevelopmentCheckpoint(this.store, {
      key,
      requestId: binding.idempotencyKey,
      expectedRevision: stored.revision,
      currentEnvelope,
      actualWorkspaceHash,
      auditedAt: occurredAt,
    });
    return this.view(outcome.checkpointRevision, outcome.checkpoint, actor);
  }

  public async action(
    workspaceId: string,
    projectId: string,
    kind: "verify" | "rollback" | "retry",
    binding: DevelopmentWriteBinding,
    actor: DevelopmentLabActor,
    occurredAt: string,
  ): Promise<DevelopmentPageViewModel> {
    assertEditor(actor);
    const { key, stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    assertBinding(stored.revision, checkpoint, binding);
    let output:
      | Awaited<ReturnType<NonNullable<DevelopmentLabActionPort["verify"]>>>
      | Awaited<ReturnType<NonNullable<DevelopmentLabActionPort["rollback"]>>>
      | { aggregate: DurableDevelopmentCheckpoint["aggregate"] };
    if (kind === "verify") {
      if (!this.actions.verify) throw new DevelopmentLabError("unavailable", "verify executor is not configured");
      output = await this.actions.verify({ checkpoint, requestId: binding.idempotencyKey, occurredAt });
    } else if (kind === "rollback") {
      if (!this.actions.rollback) throw new DevelopmentLabError("unavailable", "rollback executor is not configured");
      output = await this.actions.rollback({ checkpoint, requestId: binding.idempotencyKey, actorId: actor.actorId, occurredAt });
    } else {
      if (!this.actions.retry) throw new DevelopmentLabError("unavailable", "retry executor is not configured");
      output = { aggregate: await this.actions.retry({ checkpoint, requestId: binding.idempotencyKey, occurredAt }) };
    }
    const outcome = await executeDevelopmentCheckpointCommand(this.store, {
      key,
      expectedRevision: stored.revision,
      requestId: binding.idempotencyKey,
      commandKind: kind === "rollback" ? "apply" : kind === "retry" ? "repair" : "verify",
      occurredAt,
      mutate: (current) => ({
        aggregate: output.aggregate,
        safeBoundary: kind === "verify" ? "verification_committed" : kind === "rollback" ? "task_ready" : "repair_committed",
        workspaceHash: "workspaceHash" in output ? output.workspaceHash : current.workspaceHash,
        ...("artifacts" in output ? { artifacts: output.artifacts } : {}),
        result: { action: kind, accepted: true },
        accepted: true,
      }),
    });
    return this.view(outcome.checkpointRevision, outcome.checkpoint, actor);
  }

  public async exportEvidence(
    workspaceId: string,
    projectId: string,
    actor: DevelopmentLabActor,
  ): Promise<object> {
    const { stored, checkpoint } = await this.loaded(workspaceId, projectId, actor);
    return {
      schemaVersion: "1.0.0",
      exportedAtCheckpointRevision: stored.revision,
      developmentRunId: checkpoint.developmentRunId,
      workspaceHash: checkpoint.workspaceHash,
      manifests: checkpoint.evidenceManifests,
      evidence: checkpoint.aggregate.evidenceHistory,
      artifacts: checkpoint.verificationArtifacts,
      patches: checkpoint.patchJournal.map(({ journalEntryId, taskRunId, status, operations, diffHash }) => ({
        journalEntryId,
        taskRunId,
        status,
        operations: operations.map(({ relativePath, operation, beforeHash, afterHash }) => ({
          relativePath,
          operation,
          ...(beforeHash ? { beforeHash } : {}),
          ...(afterHash ? { afterHash } : {}),
        })),
        diffHash,
      })),
      models: checkpoint.modelSnapshots.map(({ snapshotId, scope, selectionSource, profileHash, configurationHash }) => ({
        snapshotId,
        scope,
        selectionSource,
        profileHash,
        configurationHash,
      })),
      recoveryAudits: checkpoint.recoveryAudits,
    };
  }
}
