import {
  planningContractManifest,
  planningWorkflowInputV2Schema,
  type ApprovalBindingV2,
  type DiscoveryAnalysis,
  type ExecutionPlanVersion,
  type PlanningStatusV2,
  type PlanningSubject,
  type PlanningWorkflowInputV2,
  type ProjectSpecVersion,
  type TechnicalDesignVersion,
} from "@product-woc/planning-contracts";
import {
  generateDiscovery,
  generateExecutionPlan,
  generateProjectSpec,
  generateTechnicalDesign,
  materializeExecutionPlanVersion,
  materializeProjectSpecVersion,
  materializeTechnicalDesignVersion,
  redactSensitiveText,
} from "@product-woc/planning-agent";
import type {
  LocalOutboxEvent,
  TransactionalCheckpointStore,
} from "@product-woc/planning-adapters";
import {
  approvePlanningSubject,
  createPlanningAggregate,
  recordDocumentVersion,
  recordExecutionPlanVersion,
  recordTechnicalDesignVersion,
  rejectProjectSpec,
  returnToPlanningSubject,
  validateDevelopmentStartEnvelope,
  type PlanningAggregate,
} from "@product-woc/planning-domain";

import {
  StandalonePlanningError,
  transitionSnapshot,
  type StandalonePlanningPorts,
  type StandalonePlanningRequest,
  type StandalonePlanningResult,
} from "./index.js";

export interface DurableStandalonePlanningCheckpoint {
  schemaVersion: "1.0.0";
  input: PlanningWorkflowInputV2;
  aggregate: PlanningAggregate;
  discovery?: DiscoveryAnalysis;
  projectSpec?: ProjectSpecVersion;
  projectSpecHistory?: readonly ProjectSpecVersion[];
  technicalDesign?: TechnicalDesignVersion;
  technicalDesignHistory?: readonly TechnicalDesignVersion[];
  executionPlan?: ExecutionPlanVersion;
  executionPlanHistory?: readonly ExecutionPlanVersion[];
  revisionFeedback?: Partial<Record<PlanningSubject, readonly string[]>>;
}

export interface DurableStandalonePlanningOptions {
  pauseAfterStatus?: PlanningStatusV2;
  pauseAtApprovalGates?: boolean;
  approveStatus?: ApprovalGateStatus;
  approvalRequestId?: string;
}

export type ApprovalGateStatus =
  | "awaiting_product_spec_approval"
  | "awaiting_technical_design_approval"
  | "awaiting_execution_plan_approval";

const approvalGateStatuses: readonly ApprovalGateStatus[] = [
  "awaiting_product_spec_approval",
  "awaiting_technical_design_approval",
  "awaiting_execution_plan_approval",
];

export type DurableStandalonePlanningOutcome =
  | {
      status: "paused";
      checkpointRevision: number;
      checkpoint: DurableStandalonePlanningCheckpoint;
    }
  | {
      status: "completed";
      checkpointRevision: number;
      result: StandalonePlanningResult;
    };

function checkpointKey(input: StandalonePlanningRequest): string {
  return `${input.workspaceId}:${input.projectId}`;
}

function ensureAccepted(
  stage: PlanningSubject,
  accepted: boolean,
  reason: string,
): void {
  if (!accepted) {
    throw new StandalonePlanningError(stage, `Planning command rejected: ${reason}`);
  }
}

function approvalFor(
  state: PlanningAggregate,
  subject: PlanningSubject,
): ApprovalBindingV2 {
  const approval = state.effectiveApprovals[subject];
  if (!approval) {
    throw new StandalonePlanningError(subject, "Required approval is missing");
  }
  return approval;
}

function statusEvent(
  checkpoint: DurableStandalonePlanningCheckpoint,
): LocalOutboxEvent {
  const snapshot = checkpoint.aggregate.snapshot;
  return {
    eventId: `event:${snapshot.workflowRunId}:${snapshot.revision}:${snapshot.status}`,
    type: "planning.status_changed",
    occurredAt: snapshot.updatedAt,
    payload: {
      projectId: snapshot.projectId,
      workflowRunId: snapshot.workflowRunId,
      stage: snapshot.currentStage,
      status: snapshot.status,
      revision: snapshot.revision,
    },
  };
}

async function publishOutboxEvent(
  ports: StandalonePlanningPorts,
  event: LocalOutboxEvent,
): Promise<void> {
  await ports.events.publish({
    eventId: event.eventId,
    type: event.type,
    ...event.payload,
    occurredAt: event.occurredAt,
  });
}

async function hydrateLocalViews(
  ports: StandalonePlanningPorts,
  checkpoint: DurableStandalonePlanningCheckpoint,
): Promise<void> {
  await ports.runs.saveSnapshot(checkpoint.aggregate.snapshot);
  if (checkpoint.projectSpec) {
    await ports.documents.save("project_spec", checkpoint.projectSpec);
  }
  if (checkpoint.technicalDesign) {
    await ports.documents.save("technical_design", checkpoint.technicalDesign);
  }
  if (checkpoint.executionPlan) {
    await ports.documents.save("execution_plan", checkpoint.executionPlan);
  }
  for (const approval of checkpoint.aggregate.approvalHistory) {
    await ports.approvals.append(approval);
  }
}

async function approveCurrentSubject(
  ports: StandalonePlanningPorts,
  state: PlanningAggregate,
  subject: PlanningSubject,
  actorId: string,
  requestId?: string,
): Promise<PlanningAggregate> {
  const pointer =
    subject === "project_spec"
      ? state.snapshot.projectSpec
      : subject === "technical_design"
        ? state.snapshot.technicalDesign
        : state.snapshot.executionPlan;
  if (!pointer?.valid) {
    throw new StandalonePlanningError(subject, "No valid version is available to approve");
  }
  const execution = approvePlanningSubject(state, {
    requestId: requestId ?? ports.ids.nextId(`approve-${subject}`),
    approvalId: ports.ids.nextId(`approval-${subject}`),
    actorId,
    stageRunId: ports.ids.nextId(`stage-${subject}`),
    subjectType: subject,
    subjectVersionId: pointer.versionId,
    subjectHash: pointer.hash,
    approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
    approvedAt: ports.clock.now(),
  });
  ensureAccepted(subject, execution.result.accepted, execution.result.reason);
  return execution.state;
}

function completedResult(
  checkpoint: DurableStandalonePlanningCheckpoint,
): StandalonePlanningResult {
  const { discovery, projectSpec, technicalDesign, executionPlan, aggregate } =
    checkpoint;
  const developmentStart = aggregate.developmentStart;
  if (
    !discovery ||
    !projectSpec ||
    !technicalDesign ||
    !executionPlan ||
    !developmentStart ||
    !validateDevelopmentStartEnvelope(aggregate, developmentStart).valid
  ) {
    throw new StandalonePlanningError(
      "execution_plan",
      "The durable checkpoint is incomplete or has an invalid DevelopmentStartEnvelope",
    );
  }
  return {
    input: checkpoint.input,
    discovery,
    projectSpec,
    technicalDesign,
    executionPlan,
    aggregate,
    developmentStart,
  };
}

function appendVersion<T extends { versionId: string }>(
  history: readonly T[] | undefined,
  current: T | undefined,
  next: T,
): readonly T[] {
  const existing = history ?? (current ? [current] : []);
  return existing.some(({ versionId }) => versionId === next.versionId)
    ? existing
    : [...existing, next];
}

function latestFeedback(
  checkpoint: DurableStandalonePlanningCheckpoint,
  subject: PlanningSubject,
): string | undefined {
  return checkpoint.revisionFeedback?.[subject]?.at(-1);
}

/**
 * Executes the standalone pipeline with atomic checkpoints and a local outbox.
 * Reusing the same store and request resumes from the last committed status.
 */
export async function runDurableStandalonePlanning(
  request: StandalonePlanningRequest,
  ports: StandalonePlanningPorts,
  store: TransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>,
  options: DurableStandalonePlanningOptions = {},
): Promise<DurableStandalonePlanningOutcome> {
  const input = planningWorkflowInputV2Schema.parse({
    ...request,
    idea: redactSensitiveText(request.idea),
    workflowVersion: planningContractManifest.workflowVersion,
    approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
  });
  const key = checkpointKey(request);
  let stored = await store.load(key);
  let checkpoint: DurableStandalonePlanningCheckpoint;
  let storeRevision: number | null;

  if (stored) {
    if (JSON.stringify(stored.value.input) !== JSON.stringify(input)) {
      throw new StandalonePlanningError(
        "discovery",
        "The durable checkpoint belongs to a different planning request",
      );
    }
    checkpoint = stored.value;
    storeRevision = stored.revision;
    await hydrateLocalViews(ports, checkpoint);
  } else {
    const snapshot = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workflowRunId: ports.ids.nextId("workflow-run"),
      currentStage: "discovery" as const,
      status: "collecting_idea" as const,
      revision: 0,
      updatedAt: ports.clock.now(),
    };
    checkpoint = {
      schemaVersion: "1.0.0",
      input,
      aggregate: createPlanningAggregate(snapshot, {
        approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
        workflowDefinitionVersion: planningContractManifest.workflowVersion,
        workflowDefinitionChecksum: planningContractManifest.definitionChecksum,
        validationPolicyVersion: "2.0.0",
      }),
    };
    storeRevision = null;
  }

  for (const event of await store.pendingOutbox(key)) {
    await publishOutboxEvent(ports, event);
    await store.markOutboxPublished(key, [event.eventId], ports.clock.now());
  }

  const persist = async (): Promise<void> => {
    const event = statusEvent(checkpoint);
    stored = await store.commit(key, storeRevision, checkpoint, [event]);
    storeRevision = stored.revision;
    await hydrateLocalViews(ports, checkpoint);
    await publishOutboxEvent(ports, event);
    await store.markOutboxPublished(key, [event.eventId], ports.clock.now());
  };

  if (storeRevision === null) {
    await persist();
  }

  while (checkpoint.aggregate.snapshot.status !== "ready_for_development") {
    const currentStatus = checkpoint.aggregate.snapshot.status;
    const isApprovalGate = approvalGateStatuses.includes(
      currentStatus as ApprovalGateStatus,
    );
    if (
      options.pauseAfterStatus === currentStatus ||
      (options.pauseAtApprovalGates === true &&
        isApprovalGate &&
        options.approveStatus !== currentStatus)
    ) {
      return {
        status: "paused",
        checkpointRevision: storeRevision as number,
        checkpoint,
      };
    }

    const status = currentStatus;
    if (status === "collecting_idea") {
      checkpoint = {
        ...checkpoint,
        aggregate: {
          ...checkpoint.aggregate,
          snapshot: transitionSnapshot(
            checkpoint.aggregate.snapshot,
            "analyzing_request",
            ports.clock.now(),
          ),
        },
      };
    } else if (status === "analyzing_request") {
      const discovery = await generateDiscovery(
        {
          requestId: ports.ids.nextId("generate-discovery"),
          idea: input.idea,
          decisions: [],
        },
        ports.model,
      );
      if (discovery.status !== "success") {
        throw new StandalonePlanningError("discovery", discovery.issues.join("; "));
      }
      if (discovery.analysis.outcome !== "ready_for_spec") {
        throw new StandalonePlanningError(
          "discovery",
          `Local run requires user action: ${discovery.analysis.outcome}`,
        );
      }
      checkpoint = {
        ...checkpoint,
        discovery: discovery.analysis,
        aggregate: {
          ...checkpoint.aggregate,
          snapshot: {
            ...transitionSnapshot(
              checkpoint.aggregate.snapshot,
              "generating_product_spec",
              ports.clock.now(),
            ),
            currentStage: "product_spec",
          },
        },
      };
    } else if (status === "generating_product_spec") {
      if (!checkpoint.discovery) {
        throw new StandalonePlanningError("project_spec", "Discovery is missing");
      }
      const generated = await generateProjectSpec(
        {
          requestId: ports.ids.nextId("generate-project-spec"),
          idea: input.idea,
          decisions: [],
          analysis: checkpoint.discovery,
        },
        ports.model,
      );
      if (generated.status !== "success") {
        throw new StandalonePlanningError(
          "project_spec",
          generated.issues.join("; "),
        );
      }
      const projectSpecFeedback = latestFeedback(checkpoint, "project_spec");
      const projectSpecContent = projectSpecFeedback
        ? {
            ...generated.content,
            summary: `${generated.content.summary}\nRevision request: ${projectSpecFeedback}`.slice(
              0,
              2000,
            ),
          }
        : generated.content;
      const projectSpec = materializeProjectSpecVersion(projectSpecContent, {
        versionId: ports.ids.nextId("project-spec"),
        version: (checkpoint.aggregate.snapshot.projectSpec?.version ?? 0) + 1,
        schemaVersion: "2.0.0",
        createdAt: ports.clock.now(),
        sourceDecisionIds: [],
        sourceArtifactIds: [],
        promptVersion: "1.0.0",
        modelSnapshot: generated.modelSnapshot,
      });
      const execution = recordDocumentVersion(checkpoint.aggregate, {
        requestId: ports.ids.nextId("record-project-spec"),
        subjectType: "project_spec",
        versionId: projectSpec.versionId,
        version: projectSpec.version,
        subjectHash: projectSpec.normalizedContentHash,
        recordedAt: ports.clock.now(),
      });
      ensureAccepted("project_spec", execution.result.accepted, execution.result.reason);
      checkpoint = {
        ...checkpoint,
        projectSpecHistory: appendVersion(
          checkpoint.projectSpecHistory,
          checkpoint.projectSpec,
          projectSpec,
        ),
        projectSpec,
        aggregate: execution.state,
      };
    } else if (status === "awaiting_product_spec_approval") {
      checkpoint = {
        ...checkpoint,
        aggregate: await approveCurrentSubject(
          ports,
          checkpoint.aggregate,
          "project_spec",
          input.requestedBy,
          options.approvalRequestId,
        ),
      };
    } else if (status === "generating_technical_design") {
      if (!checkpoint.projectSpec) {
        throw new StandalonePlanningError("technical_design", "Project Spec is missing");
      }
      const generated = await generateTechnicalDesign(
        {
          requestId: ports.ids.nextId("generate-technical-design"),
          projectId: input.projectId,
          workflowRunId: checkpoint.aggregate.snapshot.workflowRunId,
          approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
          projectSpec: checkpoint.projectSpec,
          projectSpecApproval: approvalFor(checkpoint.aggregate, "project_spec"),
          policy: { availablePlatformCapabilities: [] },
        },
        ports.model,
      );
      if (generated.status !== "success") {
        throw new StandalonePlanningError(
          "technical_design",
          generated.issues.join("; "),
        );
      }
      const technicalDesignFeedback = latestFeedback(
        checkpoint,
        "technical_design",
      );
      const technicalDesignContent = technicalDesignFeedback
        ? {
            ...generated.content,
            architectureSummary:
              `${generated.content.architectureSummary}\nRevision request: ${technicalDesignFeedback}`.slice(
                0,
                4000,
              ),
          }
        : generated.content;
      const technicalDesign = materializeTechnicalDesignVersion(
        technicalDesignContent,
        checkpoint.projectSpec,
        {
          versionId: ports.ids.nextId("technical-design"),
          version:
            (checkpoint.aggregate.snapshot.technicalDesign?.version ?? 0) + 1,
          schemaVersion: "2.0.0",
          createdAt: ports.clock.now(),
          sourceArtifactIds: [],
          promptVersion: "1.0.0",
          modelSnapshot: generated.modelSnapshot,
        },
        { availablePlatformCapabilities: [] },
      );
      const execution = recordTechnicalDesignVersion(
        checkpoint.aggregate,
        ports.ids.nextId("record-technical-design"),
        technicalDesign,
        ports.clock.now(),
      );
      ensureAccepted(
        "technical_design",
        execution.result.accepted,
        execution.result.reason,
      );
      checkpoint = {
        ...checkpoint,
        technicalDesignHistory: appendVersion(
          checkpoint.technicalDesignHistory,
          checkpoint.technicalDesign,
          technicalDesign,
        ),
        technicalDesign,
        aggregate: execution.state,
      };
    } else if (status === "awaiting_technical_design_approval") {
      checkpoint = {
        ...checkpoint,
        aggregate: await approveCurrentSubject(
          ports,
          checkpoint.aggregate,
          "technical_design",
          input.requestedBy,
          options.approvalRequestId,
        ),
      };
    } else if (status === "generating_execution_plan") {
      if (!checkpoint.projectSpec || !checkpoint.technicalDesign) {
        throw new StandalonePlanningError(
          "execution_plan",
          "Project Spec or Technical Design is missing",
        );
      }
      const generated = await generateExecutionPlan(
        {
          requestId: ports.ids.nextId("generate-execution-plan"),
          projectId: input.projectId,
          workflowRunId: checkpoint.aggregate.snapshot.workflowRunId,
          approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
          projectSpec: checkpoint.projectSpec,
          projectSpecApproval: approvalFor(checkpoint.aggregate, "project_spec"),
          technicalDesign: checkpoint.technicalDesign,
          technicalDesignApproval: approvalFor(
            checkpoint.aggregate,
            "technical_design",
          ),
          policy: { confirmedDecisionIds: [] },
        },
        ports.model,
      );
      if (generated.status !== "success") {
        throw new StandalonePlanningError(
          "execution_plan",
          generated.issues.join("; "),
        );
      }
      const executionPlanFeedback = latestFeedback(checkpoint, "execution_plan");
      const executionPlanContent = executionPlanFeedback
        ? {
            ...generated.content,
            summary:
              `${generated.content.summary}\nRevision request: ${executionPlanFeedback}`.slice(
                0,
                2000,
              ),
          }
        : generated.content;
      const executionPlan = materializeExecutionPlanVersion(
        executionPlanContent,
        checkpoint.projectSpec,
        checkpoint.technicalDesign,
        {
          versionId: ports.ids.nextId("execution-plan"),
          version:
            (checkpoint.aggregate.snapshot.executionPlan?.version ?? 0) + 1,
          schemaVersion: "2.0.0",
          createdAt: ports.clock.now(),
          sourceArtifactIds: [],
          promptVersion: "1.0.0",
          modelSnapshot: generated.modelSnapshot,
        },
        { confirmedDecisionIds: [] },
      );
      const execution = recordExecutionPlanVersion(
        checkpoint.aggregate,
        ports.ids.nextId("record-execution-plan"),
        executionPlan,
        ports.clock.now(),
      );
      ensureAccepted("execution_plan", execution.result.accepted, execution.result.reason);
      checkpoint = {
        ...checkpoint,
        executionPlanHistory: appendVersion(
          checkpoint.executionPlanHistory,
          checkpoint.executionPlan,
          executionPlan,
        ),
        executionPlan,
        aggregate: execution.state,
      };
    } else if (status === "awaiting_execution_plan_approval") {
      checkpoint = {
        ...checkpoint,
        aggregate: await approveCurrentSubject(
          ports,
          checkpoint.aggregate,
          "execution_plan",
          input.requestedBy,
          options.approvalRequestId,
        ),
      };
    } else {
      throw new StandalonePlanningError(
        "discovery",
        `Durable standalone runner cannot continue from ${status}`,
      );
    }
    await persist();
  }

  return {
    status: "completed",
    checkpointRevision: storeRevision as number,
    result: completedResult(checkpoint),
  };
}

export interface DurablePlanningMutation {
  requestId: string;
  actorId: string;
  subjectType: PlanningSubject;
  subjectVersionId: string;
  subjectHash: string;
}

async function commitMutation(
  key: string,
  revision: number,
  checkpoint: DurableStandalonePlanningCheckpoint,
  ports: StandalonePlanningPorts,
  store: TransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>,
): Promise<number> {
  const event = statusEvent(checkpoint);
  const stored = await store.commit(key, revision, checkpoint, [event]);
  await hydrateLocalViews(ports, checkpoint);
  await publishOutboxEvent(ports, event);
  await store.markOutboxPublished(key, [event.eventId], ports.clock.now());
  return stored.revision;
}

function assertMutationBinding(
  checkpoint: DurableStandalonePlanningCheckpoint,
  mutation: DurablePlanningMutation,
): void {
  const pointer =
    mutation.subjectType === "project_spec"
      ? checkpoint.aggregate.snapshot.projectSpec
      : mutation.subjectType === "technical_design"
        ? checkpoint.aggregate.snapshot.technicalDesign
        : checkpoint.aggregate.snapshot.executionPlan;
  if (
    !pointer?.valid ||
    pointer.versionId !== mutation.subjectVersionId ||
    pointer.hash !== mutation.subjectHash
  ) {
    throw new StandalonePlanningError(
      mutation.subjectType,
      "The supplied document version or hash is stale",
    );
  }
}

export async function returnDurablePlanningSubject(
  request: StandalonePlanningRequest,
  mutation: DurablePlanningMutation & { feedback: string },
  ports: StandalonePlanningPorts,
  store: TransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>,
): Promise<DurableStandalonePlanningOutcome> {
  const key = checkpointKey(request);
  const stored = await store.load(key);
  if (!stored) {
    throw new StandalonePlanningError(mutation.subjectType, "Planning run not found");
  }
  if (stored.value.aggregate.processedCommands[mutation.requestId]) {
    return runDurableStandalonePlanning(request, ports, store, {
      pauseAtApprovalGates: true,
    });
  }
  assertMutationBinding(stored.value, mutation);
  const execution = returnToPlanningSubject(stored.value.aggregate, {
    requestId: mutation.requestId,
    actorId: mutation.actorId,
    subjectType: mutation.subjectType,
    feedback: mutation.feedback,
    returnedAt: ports.clock.now(),
  });
  ensureAccepted(
    mutation.subjectType,
    execution.result.accepted,
    execution.result.reason,
  );
  await commitMutation(
    key,
    stored.revision,
    {
      ...stored.value,
      aggregate: execution.state,
      revisionFeedback: {
        ...stored.value.revisionFeedback,
        [mutation.subjectType]: [
          ...(stored.value.revisionFeedback?.[mutation.subjectType] ?? []),
          redactSensitiveText(mutation.feedback),
        ],
      },
    },
    ports,
    store,
  );
  return runDurableStandalonePlanning(request, ports, store, {
    pauseAtApprovalGates: true,
  });
}

export async function cancelDurablePlanning(
  request: StandalonePlanningRequest,
  mutation: Omit<DurablePlanningMutation, "subjectType"> & { reason: string },
  ports: StandalonePlanningPorts,
  store: TransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>,
): Promise<{ checkpointRevision: number; checkpoint: DurableStandalonePlanningCheckpoint }> {
  const key = checkpointKey(request);
  const stored = await store.load(key);
  if (!stored) {
    throw new StandalonePlanningError("project_spec", "Planning run not found");
  }
  const typedMutation: DurablePlanningMutation = {
    ...mutation,
    subjectType: "project_spec",
  };
  if (stored.value.aggregate.processedCommands[mutation.requestId]) {
    return { checkpointRevision: stored.revision, checkpoint: stored.value };
  }
  assertMutationBinding(stored.value, typedMutation);
  const execution = rejectProjectSpec(stored.value.aggregate, {
    requestId: mutation.requestId,
    actorId: mutation.actorId,
    reason: mutation.reason,
    rejectedAt: ports.clock.now(),
  });
  ensureAccepted("project_spec", execution.result.accepted, execution.result.reason);
  const checkpoint = { ...stored.value, aggregate: execution.state };
  const checkpointRevision = await commitMutation(
    key,
    stored.revision,
    checkpoint,
    ports,
    store,
  );
  return { checkpointRevision, checkpoint };
}
