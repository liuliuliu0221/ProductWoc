import {
  agentRunSchema,
  beginRepairCommandSchema,
  beginTaskCommandSchema,
  completeTaskCommandSchema,
  confirmPhaseGateCommandSchema,
  developmentCommandResultSchema,
  developmentControlCommandSchema,
  developmentInputSnapshotSchema,
  developmentInvalidationRecordSchema,
  developmentRunSchema,
  developmentTransitionRecordSchema,
  phaseGateDecisionSchema,
  phaseRunSchema,
  planningRevisionCommandSchema,
  recordEvidenceCommandSchema,
  recordRepairAttemptCommandSchema,
  requireDevelopmentUserActionCommandSchema,
  rerunTaskWithModelCommandSchema,
  startDevelopmentCommandSchema,
  taskRunSchema,
  transitionTaskCommandSchema,
  verificationEvidenceSchema,
  type AgentRun,
  type BeginRepairCommand,
  type BeginTaskCommand,
  type CompleteTaskCommand,
  type ConfirmPhaseGateCommand,
  type DevelopmentCommandReason,
  type DevelopmentCommandResult,
  type DevelopmentControlCommand,
  type DevelopmentInputSnapshot,
  type DevelopmentInvalidationRecord,
  type DevelopmentRun,
  type DevelopmentTransitionRecord,
  type PhaseGateDecision,
  type PhaseRun,
  type PlanningRevisionCommand,
  type RecordEvidenceCommand,
  type RecordRepairAttemptCommand,
  type RepairAttempt,
  type RequireDevelopmentUserActionCommand,
  type RerunTaskWithModelCommand,
  type StartDevelopmentCommand,
  type TaskRun,
  type TaskRunStatus,
  type TransitionTaskCommand,
  type VerificationEvidence,
} from "@product-woc/development-contracts";
import {
  approvalBindingV2Schema,
  developmentStartEnvelopeSchema,
  executionPlanContentSchema,
  executionPlanVersionSchema,
  planningSnapshotV2Schema,
  projectSpecContentSchema,
  projectSpecVersionSchema,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type ApprovalBindingV2,
  type DevelopmentStartEnvelope,
  type EvidenceType,
  type ExecutionPlanVersion,
  type PlanningSnapshotV2,
  type ProjectSpecVersion,
  type TechnicalDesignVersion,
} from "@product-woc/planning-contracts";

import { contentHash } from "./canonical-json.js";
import {
  dependentTaskIds,
  taskDefinitionHash,
  validateDevelopmentGraph,
  type DevelopmentExecutionGraph,
  type DevelopmentGraphIssue,
} from "./graph.js";
import {
  canTransitionAgentRun,
  canTransitionDevelopmentRun,
  canTransitionPhaseRun,
  canTransitionTaskRun,
} from "./state-machine.js";

export interface PlanningAuthoritySnapshot {
  snapshot: PlanningSnapshotV2;
  effectiveApprovals: readonly ApprovalBindingV2[];
  workflowDefinitionVersion: string;
  workflowDefinitionChecksum: string;
  validationPolicyVersion: string;
}

export interface CreateDevelopmentAggregateInput {
  creationRequestId: string;
  developmentRunId: string;
  envelope: DevelopmentStartEnvelope;
  authority: PlanningAuthoritySnapshot;
  projectSpec: ProjectSpecVersion;
  technicalDesign: TechnicalDesignVersion;
  executionPlan: ExecutionPlanVersion;
  workspaceBaselineHash: string;
  modelPolicySnapshotId: string;
  toolPolicyVersion: string;
  createdAt: string;
}

export type DevelopmentStartIssueCode =
  | "invalid_input"
  | "authority_not_ready"
  | "authority_mismatch"
  | "document_hash_mismatch"
  | "document_binding_mismatch"
  | "approval_binding_mismatch"
  | "workflow_binding_mismatch"
  | "envelope_identity_mismatch"
  | "invalid_graph";

export interface DevelopmentStartIssue {
  code: DevelopmentStartIssueCode;
  message: string;
  graphIssues?: readonly DevelopmentGraphIssue[];
}

export interface DevelopmentAggregate {
  run: DevelopmentRun;
  input: Readonly<DevelopmentInputSnapshot>;
  executionPlan: ExecutionPlanVersion;
  graph: DevelopmentExecutionGraph;
  phaseRuns: Readonly<Record<string, PhaseRun>>;
  taskRuns: Readonly<Record<string, TaskRun>>;
  agentRuns: Readonly<Record<string, AgentRun>>;
  repairHistory: readonly RepairAttempt[];
  evidenceHistory: readonly VerificationEvidence[];
  gateHistory: readonly PhaseGateDecision[];
  invalidationHistory: readonly DevelopmentInvalidationRecord[];
  transitionHistory: readonly DevelopmentTransitionRecord[];
  processedCommands: Readonly<Record<string, DevelopmentCommandResult>>;
}

export type DevelopmentAggregateCreation =
  | { created: true; aggregate: DevelopmentAggregate }
  | { created: false; issues: readonly DevelopmentStartIssue[] };

export interface DevelopmentCommandExecution {
  aggregate: DevelopmentAggregate;
  result: DevelopmentCommandResult;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function projectSpecContent(document: ProjectSpecVersion): unknown {
  const {
    versionId: _versionId,
    version: _version,
    normalizedContentHash: _normalizedContentHash,
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    sourceDecisionIds: _sourceDecisionIds,
    sourceArtifactIds: _sourceArtifactIds,
    promptVersion: _promptVersion,
    modelSnapshot: _modelSnapshot,
    ...content
  } = document;
  return projectSpecContentSchema.parse(content);
}

function technicalDesignContent(document: TechnicalDesignVersion): unknown {
  const {
    versionId: _versionId,
    version: _version,
    normalizedContentHash: _normalizedContentHash,
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    projectSpecVersionId: _projectSpecVersionId,
    projectSpecHash: _projectSpecHash,
    sourceArtifactIds: _sourceArtifactIds,
    promptVersion: _promptVersion,
    modelSnapshot: _modelSnapshot,
    ...content
  } = document;
  return technicalDesignContentSchema.parse(content);
}

function executionPlanContent(document: ExecutionPlanVersion): unknown {
  const {
    versionId: _versionId,
    version: _version,
    normalizedContentHash: _normalizedContentHash,
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    projectSpecVersionId: _projectSpecVersionId,
    projectSpecHash: _projectSpecHash,
    technicalDesignVersionId: _technicalDesignVersionId,
    technicalDesignHash: _technicalDesignHash,
    sourceArtifactIds: _sourceArtifactIds,
    promptVersion: _promptVersion,
    modelSnapshot: _modelSnapshot,
    ...content
  } = document;
  return executionPlanContentSchema.parse(content);
}

function inputValidationIssues(
  input: CreateDevelopmentAggregateInput,
): {
  issues: DevelopmentStartIssue[];
  graph?: DevelopmentExecutionGraph;
  envelope?: DevelopmentStartEnvelope;
  projectSpec?: ProjectSpecVersion;
  technicalDesign?: TechnicalDesignVersion;
  executionPlan?: ExecutionPlanVersion;
  authoritySnapshot?: PlanningSnapshotV2;
  approvals?: readonly ApprovalBindingV2[];
} {
  const envelopeResult = developmentStartEnvelopeSchema.safeParse(input.envelope);
  const projectResult = projectSpecVersionSchema.safeParse(input.projectSpec);
  const technicalResult = technicalDesignVersionSchema.safeParse(
    input.technicalDesign,
  );
  const executionResult = executionPlanVersionSchema.safeParse(input.executionPlan);
  const authorityResult = planningSnapshotV2Schema.safeParse(input.authority.snapshot);
  const approvalResults = input.authority.effectiveApprovals.map((approval) =>
    approvalBindingV2Schema.safeParse(approval),
  );
  if (
    !envelopeResult.success ||
    !projectResult.success ||
    !technicalResult.success ||
    !executionResult.success ||
    !authorityResult.success ||
    approvalResults.some((result) => !result.success)
  ) {
    return {
      issues: [{ code: "invalid_input", message: "Stage 3 input Schema validation failed" }],
    };
  }

  const envelope = envelopeResult.data;
  const projectSpec = projectResult.data;
  const technicalDesign = technicalResult.data;
  const executionPlan = executionResult.data;
  const authoritySnapshot = authorityResult.data;
  const approvals = approvalResults.flatMap((result) =>
    result.success ? [result.data] : [],
  );
  const issues: DevelopmentStartIssue[] = [];

  if (authoritySnapshot.status !== "ready_for_development") {
    issues.push({
      code: "authority_not_ready",
      message: "Planning authority is not ready for development",
    });
  }
  if (
    envelope.workspaceId !== authoritySnapshot.workspaceId ||
    envelope.projectId !== authoritySnapshot.projectId ||
    envelope.planningWorkflowRunId !== authoritySnapshot.workflowRunId
  ) {
    issues.push({
      code: "authority_mismatch",
      message: "Envelope identity does not match the current Planning authority",
    });
  }

  const projectHash = contentHash(projectSpecContent(projectSpec));
  const technicalHash = contentHash(technicalDesignContent(technicalDesign));
  const executionHash = contentHash(executionPlanContent(executionPlan));
  if (
    projectHash !== projectSpec.normalizedContentHash ||
    technicalHash !== technicalDesign.normalizedContentHash ||
    executionHash !== executionPlan.normalizedContentHash
  ) {
    issues.push({
      code: "document_hash_mismatch",
      message: "A bound planning document does not match its content hash",
    });
  }

  const currentPointersMatch =
    authoritySnapshot.projectSpec?.valid === true &&
    authoritySnapshot.projectSpec.versionId === projectSpec.versionId &&
    authoritySnapshot.projectSpec.hash === projectSpec.normalizedContentHash &&
    authoritySnapshot.technicalDesign?.valid === true &&
    authoritySnapshot.technicalDesign.versionId === technicalDesign.versionId &&
    authoritySnapshot.technicalDesign.hash ===
      technicalDesign.normalizedContentHash &&
    authoritySnapshot.executionPlan?.valid === true &&
    authoritySnapshot.executionPlan.versionId === executionPlan.versionId &&
    authoritySnapshot.executionPlan.hash === executionPlan.normalizedContentHash;
  const envelopeDocumentsMatch =
    envelope.projectSpecVersionId === projectSpec.versionId &&
    envelope.projectSpecHash === projectSpec.normalizedContentHash &&
    envelope.technicalDesignVersionId === technicalDesign.versionId &&
    envelope.technicalDesignHash === technicalDesign.normalizedContentHash &&
    envelope.executionPlanVersionId === executionPlan.versionId &&
    envelope.executionPlanHash === executionPlan.normalizedContentHash;
  const upstreamDocumentsMatch =
    technicalDesign.projectSpecVersionId === projectSpec.versionId &&
    technicalDesign.projectSpecHash === projectSpec.normalizedContentHash &&
    executionPlan.projectSpecVersionId === projectSpec.versionId &&
    executionPlan.projectSpecHash === projectSpec.normalizedContentHash &&
    executionPlan.technicalDesignVersionId === technicalDesign.versionId &&
    executionPlan.technicalDesignHash === technicalDesign.normalizedContentHash;
  if (!currentPointersMatch || !envelopeDocumentsMatch || !upstreamDocumentsMatch) {
    issues.push({
      code: "document_binding_mismatch",
      message: "Envelope, current pointers, or upstream document bindings differ",
    });
  }

  const subjects = [
    ["project_spec", projectSpec.versionId, projectSpec.normalizedContentHash],
    [
      "technical_design",
      technicalDesign.versionId,
      technicalDesign.normalizedContentHash,
    ],
    ["execution_plan", executionPlan.versionId, executionPlan.normalizedContentHash],
  ] as const;
  const approvalsMatch = subjects.every(([subject, versionId, hash], index) => {
    const approval = approvals.find(
      (candidate) => candidate.approvalId === envelope.approvalIds[index],
    );
    return (
      approval?.subjectType === subject &&
      approval.projectId === envelope.projectId &&
      approval.workflowRunId === envelope.planningWorkflowRunId &&
      approval.subjectVersionId === versionId &&
      approval.subjectHash === hash
    );
  });
  if (!approvalsMatch || approvals.length !== 3) {
    issues.push({
      code: "approval_binding_mismatch",
      message: "The three effective approvals do not match the Envelope bindings",
    });
  }

  if (
    envelope.workflowDefinitionVersion !==
      input.authority.workflowDefinitionVersion ||
    envelope.workflowDefinitionChecksum !==
      input.authority.workflowDefinitionChecksum ||
    envelope.validationPolicyVersion !== input.authority.validationPolicyVersion
  ) {
    issues.push({
      code: "workflow_binding_mismatch",
      message: "Workflow definition or validation policy is stale",
    });
  }

  const expectedEnvelopeId = `env:${contentHash([
    envelope.planningWorkflowRunId,
    projectSpec.versionId,
    technicalDesign.versionId,
    executionPlan.versionId,
  ]).slice(0, 48)}`;
  if (envelope.envelopeId !== expectedEnvelopeId) {
    issues.push({
      code: "envelope_identity_mismatch",
      message: "Envelope ID does not match its immutable document identity",
    });
  }

  const graphResult = validateDevelopmentGraph(executionPlan);
  if (!graphResult.valid) {
    issues.push({
      code: "invalid_graph",
      message: "Execution Plan cannot be scheduled",
      graphIssues: graphResult.issues,
    });
  }

  return {
    issues,
    ...(graphResult.valid ? { graph: graphResult.graph } : {}),
    envelope,
    projectSpec,
    technicalDesign,
    executionPlan,
    authoritySnapshot,
    approvals,
  };
}

function phaseRunId(developmentRunId: string, executionPhaseId: string): string {
  return `phase:${contentHash([developmentRunId, executionPhaseId]).slice(0, 48)}`;
}

function taskRunId(developmentRunId: string, executionTaskId: string): string {
  return `task:${contentHash([developmentRunId, executionTaskId]).slice(0, 48)}`;
}

export function createDevelopmentAggregate(
  input: CreateDevelopmentAggregateInput,
): DevelopmentAggregateCreation {
  const validation = inputValidationIssues(input);
  if (
    validation.issues.length > 0 ||
    !validation.graph ||
    !validation.envelope ||
    !validation.executionPlan
  ) {
    return { created: false, issues: validation.issues };
  }
  const snapshot = deepFreeze(
    developmentInputSnapshotSchema.parse({
      developmentRunId: input.developmentRunId,
      envelopeId: validation.envelope.envelopeId,
      envelopeHash: contentHash(validation.envelope),
      workspaceId: validation.envelope.workspaceId,
      projectId: validation.envelope.projectId,
      planningWorkflowRunId: validation.envelope.planningWorkflowRunId,
      projectSpecVersionId: validation.envelope.projectSpecVersionId,
      projectSpecHash: validation.envelope.projectSpecHash,
      technicalDesignVersionId: validation.envelope.technicalDesignVersionId,
      technicalDesignHash: validation.envelope.technicalDesignHash,
      executionPlanVersionId: validation.envelope.executionPlanVersionId,
      executionPlanHash: validation.envelope.executionPlanHash,
      approvalIds: validation.envelope.approvalIds,
      workflowDefinitionVersion: validation.envelope.workflowDefinitionVersion,
      workflowDefinitionChecksum:
        validation.envelope.workflowDefinitionChecksum,
      validationPolicyVersion: validation.envelope.validationPolicyVersion,
      taskGraphHash: validation.graph.graphHash,
      workspaceBaselineHash: input.workspaceBaselineHash,
      modelPolicySnapshotId: input.modelPolicySnapshotId,
      toolPolicyVersion: input.toolPolicyVersion,
      createdAt: input.createdAt,
    }),
  );
  const run = developmentRunSchema.parse({
    developmentRunId: input.developmentRunId,
    input: snapshot,
    status: "ready",
    revision: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  const phaseRuns: Record<string, PhaseRun> = {};
  for (const phase of validation.executionPlan.phases) {
    const id = phaseRunId(input.developmentRunId, phase.id);
    phaseRuns[id] = phaseRunSchema.parse({
      phaseRunId: id,
      developmentRunId: input.developmentRunId,
      executionPhaseId: phase.id,
      taskRunIds: phase.taskIds.map((taskId) =>
        taskRunId(input.developmentRunId, taskId),
      ),
      status: "pending",
      revision: 0,
    });
  }
  const taskRuns: Record<string, TaskRun> = {};
  for (const task of validation.executionPlan.tasks) {
    const id = taskRunId(input.developmentRunId, task.id);
    taskRuns[id] = taskRunSchema.parse({
      taskRunId: id,
      developmentRunId: input.developmentRunId,
      executionTaskId: task.id,
      taskDefinitionHash: taskDefinitionHash(task),
      status: "pending",
      revision: 0,
      agentRunIds: [],
      evidenceIds: [],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
  }
  return {
    created: true,
    aggregate: {
      run,
      input: snapshot,
      executionPlan: validation.executionPlan,
      graph: validation.graph,
      phaseRuns,
      taskRuns,
      agentRuns: {},
      repairHistory: [],
      evidenceHistory: [],
      gateHistory: [],
      invalidationHistory: [],
      transitionHistory: [],
      processedCommands: {},
    },
  };
}

function resultFor(
  aggregate: DevelopmentAggregate,
  requestId: string,
  accepted: boolean,
  reason: DevelopmentCommandReason,
  references: { phaseRunId?: string; taskRunId?: string } = {},
): DevelopmentCommandResult {
  return developmentCommandResultSchema.parse({
    requestId,
    accepted,
    reason,
    runStatus: aggregate.run.status,
    ...references,
  });
}

function presentReferences(
  phaseRunId: string | undefined,
  taskRunId: string | undefined,
): { phaseRunId?: string; taskRunId?: string } {
  return {
    ...(phaseRunId ? { phaseRunId } : {}),
    ...(taskRunId ? { taskRunId } : {}),
  };
}

function withoutCompletedAt<T extends { completedAt?: string | undefined }>(
  value: T,
): Omit<T, "completedAt"> {
  const { completedAt, ...rest } = value;
  void completedAt;
  return rest;
}

function presentRunPointers(
  currentPhaseRunId: string | undefined,
  currentTaskRunId: string | undefined,
): { currentPhaseRunId?: string; currentTaskRunId?: string } {
  return {
    ...(currentPhaseRunId ? { currentPhaseRunId } : {}),
    ...(currentTaskRunId ? { currentTaskRunId } : {}),
  };
}

function remember(
  aggregate: DevelopmentAggregate,
  result: DevelopmentCommandResult,
): DevelopmentCommandExecution {
  return {
    aggregate: {
      ...aggregate,
      processedCommands: {
        ...aggregate.processedCommands,
        [result.requestId]: result,
      },
    },
    result,
  };
}

function previousExecution(
  aggregate: DevelopmentAggregate,
  requestId: string,
): DevelopmentCommandExecution | undefined {
  const previous = aggregate.processedCommands[requestId];
  return previous ? { aggregate, result: previous } : undefined;
}

function transitionRecord(
  requestId: string,
  entityType: DevelopmentTransitionRecord["entityType"],
  entityId: string,
  fromStatus: string,
  toStatus: string,
  transitionedAt: string,
): DevelopmentTransitionRecord {
  return developmentTransitionRecordSchema.parse({
    transitionId: `transition:${contentHash([
      requestId,
      entityType,
      entityId,
      fromStatus,
      toStatus,
    ]).slice(0, 48)}`,
    requestId,
    entityType,
    entityId,
    fromStatus,
    toStatus,
    transitionedAt,
  });
}

function phaseRunForExecutionId(
  aggregate: DevelopmentAggregate,
  executionPhaseId: string,
): PhaseRun | undefined {
  return Object.values(aggregate.phaseRuns).find(
    (phase) => phase.executionPhaseId === executionPhaseId,
  );
}

function taskRunForExecutionId(
  aggregate: DevelopmentAggregate,
  executionTaskId: string,
): TaskRun | undefined {
  return Object.values(aggregate.taskRuns).find(
    (task) => task.executionTaskId === executionTaskId,
  );
}

function taskDefinition(aggregate: DevelopmentAggregate, task: TaskRun) {
  return aggregate.executionPlan.tasks.find(
    (definition) => definition.id === task.executionTaskId,
  );
}

function isInvalidated(
  aggregate: DevelopmentAggregate,
  targetType: DevelopmentInvalidationRecord["targetType"],
  targetId: string,
): boolean {
  return aggregate.invalidationHistory.some(
    (record) => record.targetType === targetType && record.targetId === targetId,
  );
}

function mappedEvidenceType(type: EvidenceType): VerificationEvidence["type"] {
  const mapping: Readonly<Record<EvidenceType, VerificationEvidence["type"]>> = {
    test_report: "test_report",
    typecheck: "typecheck_report",
    lint_report: "lint_report",
    build_artifact: "build_report",
    screenshot: "screenshot",
    runtime_log: "runtime_log",
    security_report: "security_report",
    manual_approval: "manual_confirmation",
  };
  return mapping[type];
}

function evidenceForTask(
  aggregate: DevelopmentAggregate,
  taskRunIdValue: string,
): readonly VerificationEvidence[] {
  return aggregate.evidenceHistory.filter(
    (evidence) =>
      evidence.taskRunId === taskRunIdValue &&
      !isInvalidated(aggregate, "evidence", evidence.evidenceId),
  );
}

function taskDependenciesComplete(
  aggregate: DevelopmentAggregate,
  task: TaskRun,
): boolean {
  return (aggregate.graph.taskDependencies[task.executionTaskId] ?? []).every(
    (dependencyId) =>
      taskRunForExecutionId(aggregate, dependencyId)?.status === "completed",
  );
}

function gateDecisionIsValid(
  aggregate: DevelopmentAggregate,
  decision: PhaseGateDecision,
): boolean {
  return !isInvalidated(aggregate, "gate", decision.decisionId);
}

function updateRunStatus(
  aggregate: DevelopmentAggregate,
  requestId: string,
  toStatus: DevelopmentRun["status"],
  at: string,
  pointers: { currentPhaseRunId?: string; currentTaskRunId?: string } = {},
): DevelopmentAggregate {
  const fromStatus = aggregate.run.status;
  if (fromStatus === toStatus || !canTransitionDevelopmentRun(fromStatus, toStatus)) {
    return aggregate;
  }
  const runBase =
    toStatus === "completed" ? aggregate.run : withoutCompletedAt(aggregate.run);
  return {
    ...aggregate,
    run: developmentRunSchema.parse({
      ...runBase,
      status: toStatus,
      revision: aggregate.run.revision + 1,
      updatedAt: at,
      ...pointers,
      ...(toStatus === "completed" ? { completedAt: at } : {}),
    }),
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "development_run",
        aggregate.run.developmentRunId,
        fromStatus,
        toStatus,
        at,
      ),
    ],
  };
}

function updatePhaseStatus(
  aggregate: DevelopmentAggregate,
  requestId: string,
  phase: PhaseRun,
  toStatus: PhaseRun["status"],
  at: string,
): DevelopmentAggregate {
  if (
    phase.status === toStatus ||
    !canTransitionPhaseRun(phase.status, toStatus)
  ) {
    return aggregate;
  }
  const phaseBase =
    toStatus === "completed" ? phase : withoutCompletedAt(phase);
  const updated = phaseRunSchema.parse({
    ...phaseBase,
    status: toStatus,
    revision: phase.revision + 1,
    ...(toStatus === "running" && !phase.startedAt ? { startedAt: at } : {}),
    ...(toStatus === "completed" ? { completedAt: at } : {}),
  });
  return {
    ...aggregate,
    phaseRuns: { ...aggregate.phaseRuns, [phase.phaseRunId]: updated },
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "phase_run",
        phase.phaseRunId,
        phase.status,
        toStatus,
        at,
      ),
    ],
  };
}

function updateTaskStatus(
  aggregate: DevelopmentAggregate,
  requestId: string,
  task: TaskRun,
  toStatus: TaskRunStatus,
  at: string,
  additions: Partial<TaskRun> = {},
): DevelopmentAggregate {
  if (task.status === toStatus || !canTransitionTaskRun(task.status, toStatus)) {
    return aggregate;
  }
  const taskBase =
    toStatus === "completed" ? task : withoutCompletedAt(task);
  const updated = taskRunSchema.parse({
    ...taskBase,
    ...additions,
    status: toStatus,
    revision: task.revision + 1,
    updatedAt: at,
    ...(toStatus === "completed" ? { completedAt: at } : {}),
  });
  return {
    ...aggregate,
    taskRuns: { ...aggregate.taskRuns, [task.taskRunId]: updated },
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "task_run",
        task.taskRunId,
        task.status,
        toStatus,
        at,
      ),
    ],
  };
}

function updateAgentStatus(
  aggregate: DevelopmentAggregate,
  requestId: string,
  agent: AgentRun,
  toStatus: AgentRun["status"],
  at: string,
): DevelopmentAggregate {
  if (
    agent.status === toStatus ||
    !canTransitionAgentRun(agent.status, toStatus)
  ) {
    return aggregate;
  }
  const updated = agentRunSchema.parse({
    ...agent,
    status: toStatus,
    ...(toStatus === "completed" || toStatus === "failed" || toStatus === "stale"
      ? { completedAt: at }
      : {}),
  });
  return {
    ...aggregate,
    agentRuns: { ...aggregate.agentRuns, [agent.agentRunId]: updated },
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "agent_run",
        agent.agentRunId,
        agent.status,
        toStatus,
        at,
      ),
    ],
  };
}

function resetTaskForRerun(
  aggregate: DevelopmentAggregate,
  requestId: string,
  task: TaskRun,
  toStatus: "pending" | "assembling_context",
  at: string,
  additions: Partial<TaskRun> = {},
): DevelopmentAggregate {
  const updated = taskRunSchema.parse({
    ...withoutCompletedAt(task),
    ...additions,
    status: toStatus,
    revision: task.revision + 1,
    updatedAt: at,
    evidenceIds: [],
  });
  return {
    ...aggregate,
    taskRuns: { ...aggregate.taskRuns, [task.taskRunId]: updated },
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "task_run",
        task.taskRunId,
        task.status,
        toStatus,
        at,
      ),
    ],
  };
}

function resetPhaseForRerun(
  aggregate: DevelopmentAggregate,
  requestId: string,
  phase: PhaseRun,
  toStatus: "pending" | "running",
  at: string,
): DevelopmentAggregate {
  const updated = phaseRunSchema.parse({
    ...withoutCompletedAt(phase),
    status: toStatus,
    revision: phase.revision + 1,
    ...(toStatus === "running" && !phase.startedAt ? { startedAt: at } : {}),
  });
  return {
    ...aggregate,
    phaseRuns: { ...aggregate.phaseRuns, [phase.phaseRunId]: updated },
    transitionHistory: [
      ...aggregate.transitionHistory,
      transitionRecord(
        requestId,
        "phase_run",
        phase.phaseRunId,
        phase.status,
        toStatus,
        at,
      ),
    ],
  };
}

function activatePhaseAndTask(
  aggregate: DevelopmentAggregate,
  requestId: string,
  executionPhaseId: string,
  at: string,
): DevelopmentAggregate {
  let next = aggregate;
  let phase = phaseRunForExecutionId(next, executionPhaseId);
  if (!phase) {
    return aggregate;
  }
  if (phase.status === "pending") {
    next = updatePhaseStatus(next, requestId, phase, "ready", at);
    phase = next.phaseRuns[phase.phaseRunId];
  }
  if (phase?.status === "ready") {
    next = updatePhaseStatus(next, requestId, phase, "running", at);
    phase = next.phaseRuns[phase.phaseRunId];
  }
  if (!phase) {
    return aggregate;
  }
  const candidate = aggregate.graph.taskOrder
    .map((taskId) => taskRunForExecutionId(next, taskId))
    .find(
      (task) =>
        task?.status === "pending" &&
        aggregate.graph.taskPhase[task.executionTaskId] === executionPhaseId &&
        taskDependenciesComplete(next, task),
    );
  if (candidate) {
    next = updateTaskStatus(next, requestId, candidate, "ready", at);
    next = {
      ...next,
      run: developmentRunSchema.parse({
        ...next.run,
        currentPhaseRunId: phase.phaseRunId,
        currentTaskRunId: candidate.taskRunId,
        updatedAt: at,
      }),
    };
  }
  return next;
}

function activateNextPhase(
  aggregate: DevelopmentAggregate,
  requestId: string,
  at: string,
): DevelopmentAggregate {
  const nextPhaseId = aggregate.graph.phaseOrder.find((phaseId) => {
    const phase = phaseRunForExecutionId(aggregate, phaseId);
    return (
      phase?.status === "pending" &&
      (aggregate.graph.phaseDependencies[phaseId] ?? []).every(
        (dependencyId) =>
          phaseRunForExecutionId(aggregate, dependencyId)?.status === "completed",
      )
    );
  });
  return nextPhaseId
    ? activatePhaseAndTask(aggregate, requestId, nextPhaseId, at)
    : aggregate;
}

function allPhaseTasksCompleted(
  aggregate: DevelopmentAggregate,
  phase: PhaseRun,
): boolean {
  return phase.taskRunIds.every(
    (id) => aggregate.taskRuns[id]?.status === "completed",
  );
}

function allRequiredTaskEvidencePresent(
  aggregate: DevelopmentAggregate,
  phase: PhaseRun,
): boolean {
  return phase.taskRunIds.every((id) => {
    const task = aggregate.taskRuns[id];
    const definition = task && taskDefinition(aggregate, task);
    if (!task || !definition) {
      return false;
    }
    const evidence = evidenceForTask(aggregate, id);
    return definition.verificationSteps
      .filter(({ required }) => required)
      .every((step) =>
        evidence.some(
          (item) =>
            task.evidenceIds.includes(item.evidenceId) &&
            item.verificationStepId === step.id &&
            item.type === mappedEvidenceType(step.evidenceType) &&
            item.outcome === "passed",
        ),
      );
  });
}

function progressAfterTaskCompletion(
  aggregate: DevelopmentAggregate,
  requestId: string,
  completedTask: TaskRun,
  at: string,
): DevelopmentAggregate {
  const phaseId = aggregate.graph.taskPhase[completedTask.executionTaskId];
  const phase = phaseId ? phaseRunForExecutionId(aggregate, phaseId) : undefined;
  if (!phase) {
    return aggregate;
  }
  if (!allPhaseTasksCompleted(aggregate, phase)) {
    return activatePhaseAndTask(aggregate, requestId, phase.executionPhaseId, at);
  }
  if (!allRequiredTaskEvidencePresent(aggregate, phase)) {
    return updateRunStatus(aggregate, requestId, "needs_user_action", at);
  }
  const gates = aggregate.executionPlan.userGates.filter(
    (gate) => gate.afterPhaseId === phase.executionPhaseId,
  );
  if (gates.length > 0) {
    let next = updatePhaseStatus(aggregate, requestId, phase, "awaiting_gate", at);
    next = updateRunStatus(next, requestId, "awaiting_user_gate", at, {
      currentPhaseRunId: phase.phaseRunId,
    });
    return next;
  }
  let next = updatePhaseStatus(aggregate, requestId, phase, "completed", at);
  next = activateNextPhase(next, requestId, at);
  const allPhasesComplete = Object.values(next.phaseRuns).every(
    (candidate) => candidate.status === "completed",
  );
  return allPhasesComplete
    ? updateRunStatus(next, requestId, "completed", at)
    : next;
}

export function selectNextReadyTask(
  aggregate: DevelopmentAggregate,
): TaskRun | undefined {
  if (aggregate.run.status !== "running") {
    return undefined;
  }
  return aggregate.graph.taskOrder
    .map((executionTaskId) => taskRunForExecutionId(aggregate, executionTaskId))
    .find((task) => task?.status === "ready");
}

export function startDevelopmentRun(
  aggregate: DevelopmentAggregate,
  commandValue: StartDevelopmentCommand,
): DevelopmentCommandExecution {
  const command = startDevelopmentCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  if (aggregate.run.status !== "ready") {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status"),
    );
  }
  let next = updateRunStatus(
    aggregate,
    command.requestId,
    "running",
    command.startedAt,
  );
  next = activateNextPhase(next, command.requestId, command.startedAt);
  return remember(
    next,
    resultFor(
      next,
      command.requestId,
      true,
      "accepted",
      presentReferences(
        next.run.currentPhaseRunId,
        next.run.currentTaskRunId,
      ),
    ),
  );
}

export function beginTask(
  aggregate: DevelopmentAggregate,
  commandValue: BeginTaskCommand,
): DevelopmentCommandExecution {
  const command = beginTaskCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  if (
    aggregate.run.status !== "running" ||
    task.status !== "ready" ||
    !taskDependenciesComplete(aggregate, task) ||
    aggregate.agentRuns[command.agentRunId]
  ) {
    const reason = !taskDependenciesComplete(aggregate, task)
      ? "dependency_incomplete"
      : "invalid_status";
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, reason, {
        taskRunId: task.taskRunId,
      }),
    );
  }
  const agent = agentRunSchema.parse({
    agentRunId: command.agentRunId,
    developmentRunId: aggregate.run.developmentRunId,
    taskRunId: task.taskRunId,
    purpose: "implementation",
    modelSnapshotId: command.modelSnapshotId,
    status: "ready",
    createdAt: command.begunAt,
  });
  let next = updateTaskStatus(
    aggregate,
    command.requestId,
    task,
    "assembling_context",
    command.begunAt,
    {
      modelSnapshotId: command.modelSnapshotId,
      agentRunIds: [...task.agentRunIds, command.agentRunId],
    },
  );
  next = {
    ...next,
    agentRuns: { ...next.agentRuns, [agent.agentRunId]: agent },
  };
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

export function beginRepair(
  aggregate: DevelopmentAggregate,
  commandValue: BeginRepairCommand,
): DevelopmentCommandExecution {
  const command = beginRepairCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  const evidence = aggregate.evidenceHistory.find(
    ({ evidenceId }) => evidenceId === command.attempt.failureEvidenceId,
  );
  const taskAttempts = aggregate.repairHistory.filter(
    (attempt) =>
      aggregate.agentRuns[attempt.agentRunId]?.taskRunId === task.taskRunId,
  );
  const fingerprint = evidence
    ? contentHash([
        evidence.verificationStepId,
        evidence.errorCategory,
        evidence.artifactHash,
        evidence.summary,
      ])
    : undefined;
  const invalid =
    aggregate.run.status !== "running" ||
    (task.status !== "verifying" && task.status !== "repairing") ||
    !task.modelSnapshotId ||
    !evidence ||
    evidence.outcome !== "failed" ||
    evidence.taskRunId !== task.taskRunId ||
    evidence.modelSnapshotId !== task.modelSnapshotId ||
    isInvalidated(aggregate, "evidence", evidence.evidenceId) ||
    command.attempt.status !== "proposed" ||
    command.attempt.errorCategory !== "verification_failed" ||
    taskAttempts.length >= command.maxAttempts ||
    taskAttempts.some(
      ({ failureFingerprint: previousFingerprint }) =>
        previousFingerprint === command.attempt.failureFingerprint,
    ) ||
    command.attempt.attemptNumber !== taskAttempts.length + 1 ||
    command.attempt.failureFingerprint !== fingerprint ||
    command.attempt.errorCategory !== evidence.errorCategory ||
    command.attempt.createdAt !== command.begunAt ||
    aggregate.agentRuns[command.attempt.agentRunId] !== undefined ||
    aggregate.repairHistory.some(
      ({ repairAttemptId, agentRunId, patchSetId }) =>
        repairAttemptId === command.attempt.repairAttemptId ||
        agentRunId === command.attempt.agentRunId ||
        patchSetId === command.attempt.patchSetId,
    );
  if (invalid) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "evidence_mismatch", {
        taskRunId: task.taskRunId,
      }),
    );
  }

  let next = aggregate;
  const previousAgentId = task.agentRunIds.at(-1);
  const previousAgent = previousAgentId
    ? next.agentRuns[previousAgentId]
    : undefined;
  if (previousAgent?.status === "running") {
    next = updateAgentStatus(
      next,
      command.requestId,
      previousAgent,
      task.status === "repairing" ? "failed" : "completed",
      command.begunAt,
    );
  }
  const repairAgent = agentRunSchema.parse({
    agentRunId: command.attempt.agentRunId,
    developmentRunId: aggregate.run.developmentRunId,
    taskRunId: task.taskRunId,
    purpose: "repair",
    modelSnapshotId: command.attempt.modelSnapshotId,
    status: "running",
    createdAt: command.begunAt,
  });
  if (task.status === "verifying") {
    next = updateTaskStatus(
      next,
      command.requestId,
      next.taskRuns[task.taskRunId] as TaskRun,
      "repairing",
      command.begunAt,
      {
        modelSnapshotId: command.attempt.modelSnapshotId,
        agentRunIds: [...task.agentRunIds, command.attempt.agentRunId],
      },
    );
  } else {
    const updatedTask = taskRunSchema.parse({
      ...task,
      modelSnapshotId: command.attempt.modelSnapshotId,
      agentRunIds: [...task.agentRunIds, command.attempt.agentRunId],
      revision: task.revision + 1,
      updatedAt: command.begunAt,
    });
    next = {
      ...next,
      taskRuns: { ...next.taskRuns, [task.taskRunId]: updatedTask },
    };
  }
  next = {
    ...next,
    agentRuns: {
      ...next.agentRuns,
      [repairAgent.agentRunId]: repairAgent,
    },
    repairHistory: [...next.repairHistory, command.attempt],
  };
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

export function requireDevelopmentUserAction(
  aggregate: DevelopmentAggregate,
  commandValue: RequireDevelopmentUserActionCommand,
): DevelopmentCommandExecution {
  const command = requireDevelopmentUserActionCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  if (
    aggregate.run.status !== "running" ||
    (task.status !== "verifying" && task.status !== "repairing")
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  const next = updateRunStatus(
    aggregate,
    command.requestId,
    "needs_user_action",
    command.requiredAt,
  );
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

export function recordRepairAttemptOutcome(
  aggregate: DevelopmentAggregate,
  commandValue: RecordRepairAttemptCommand,
): DevelopmentCommandExecution {
  const command = recordRepairAttemptCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  const attempt = aggregate.repairHistory.find(
    ({ repairAttemptId }) => repairAttemptId === command.repairAttemptId,
  );
  const agent = attempt ? aggregate.agentRuns[attempt.agentRunId] : undefined;
  const validTransition =
    attempt?.status === "proposed"
      ? command.status === "patch_applied"
      : attempt?.status === "patch_applied"
        ? command.status === "verification_failed" || command.status === "verified"
        : false;
  if (
    !task ||
    !attempt ||
    !agent ||
    agent.taskRunId !== task.taskRunId ||
    task.status !== "repairing" ||
    !validTransition
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        ...(task ? { taskRunId: task.taskRunId } : {}),
      }),
    );
  }
  let next: DevelopmentAggregate = {
    ...aggregate,
    repairHistory: aggregate.repairHistory.map((item) =>
      item.repairAttemptId === attempt.repairAttemptId
        ? {
            ...item,
            status: command.status,
            ...(command.status === "patch_applied"
              ? {}
              : { completedAt: command.completedAt }),
          }
        : item,
    ),
  };
  if (command.status === "verification_failed" && agent.status === "running") {
    next = updateAgentStatus(
      next,
      command.requestId,
      agent,
      "failed",
      command.completedAt,
    );
  }
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

export function transitionTask(
  aggregate: DevelopmentAggregate,
  commandValue: TransitionTaskCommand,
): DevelopmentCommandExecution {
  const command = transitionTaskCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  if (
    command.toStatus === "completed" ||
    command.toStatus === "stale" ||
    command.toStatus === "ready" ||
    command.toStatus === "pending" ||
    !canTransitionTaskRun(task.status, command.toStatus)
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  let next = updateTaskStatus(
    aggregate,
    command.requestId,
    task,
    command.toStatus,
    command.transitionedAt,
  );
  const currentAgentId = task.agentRunIds.at(-1);
  const agent = currentAgentId ? next.agentRuns[currentAgentId] : undefined;
  const desiredAgentStatus =
    command.toStatus === "generating_change"
      ? "running"
      : command.toStatus === "failed"
        ? "failed"
        : undefined;
  if (
    agent &&
    desiredAgentStatus &&
    canTransitionAgentRun(agent.status, desiredAgentStatus)
  ) {
    const updatedAgent = agentRunSchema.parse({
      ...agent,
      status: desiredAgentStatus,
      ...(desiredAgentStatus === "failed"
        ? { completedAt: command.transitionedAt }
        : {}),
    });
    next = {
      ...next,
      agentRuns: { ...next.agentRuns, [agent.agentRunId]: updatedAgent },
      transitionHistory: [
        ...next.transitionHistory,
        transitionRecord(
          command.requestId,
          "agent_run",
          agent.agentRunId,
          agent.status,
          desiredAgentStatus,
          command.transitionedAt,
        ),
      ],
    };
  }
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

export function recordTaskEvidence(
  aggregate: DevelopmentAggregate,
  commandValue: RecordEvidenceCommand,
): DevelopmentCommandExecution {
  const command = recordEvidenceCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const evidence = verificationEvidenceSchema.parse(command.evidence);
  const task = aggregate.taskRuns[evidence.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  const existing = aggregate.evidenceHistory.find(
    (item) => item.evidenceId === evidence.evidenceId,
  );
  if (existing) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, true, "duplicate", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  const definition = taskDefinition(aggregate, task);
  const verification = definition?.verificationSteps.find(
    (step) => step.id === evidence.verificationStepId,
  );
  if (
    !definition ||
    !verification ||
    (task.status !== "verifying" && task.status !== "repairing") ||
    evidence.developmentRunId !== aggregate.run.developmentRunId ||
    evidence.taskDefinitionHash !== task.taskDefinitionHash ||
    evidence.modelSnapshotId !== task.modelSnapshotId ||
    evidence.type !== mappedEvidenceType(verification.evidenceType)
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "evidence_mismatch", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  const next = {
    ...aggregate,
    evidenceHistory: [...aggregate.evidenceHistory, evidence],
  };
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

function requiredEvidenceMatches(
  aggregate: DevelopmentAggregate,
  task: TaskRun,
  evidenceIds: readonly string[],
): boolean {
  const definition = taskDefinition(aggregate, task);
  if (!definition || !task.modelSnapshotId) {
    return false;
  }
  const selected = evidenceIds.flatMap((id) => {
    const evidence = aggregate.evidenceHistory.find(
      (item) => item.evidenceId === id,
    );
    return evidence && !isInvalidated(aggregate, "evidence", id) ? [evidence] : [];
  });
  const first = selected[0];
  if (
    !first ||
    selected.some(
      (evidence) =>
        evidence.workspaceHash !== first.workspaceHash ||
        evidence.patchJournalEntryId !== first.patchJournalEntryId ||
        evidence.artifactId.length === 0,
    )
  ) {
    return false;
  }
  return definition.verificationSteps
    .filter(({ required }) => required)
    .every((step) =>
      selected.some(
        (evidence) =>
          evidence.taskRunId === task.taskRunId &&
          evidence.verificationStepId === step.id &&
          evidence.taskDefinitionHash === task.taskDefinitionHash &&
          evidence.modelSnapshotId === task.modelSnapshotId &&
          evidence.type === mappedEvidenceType(step.evidenceType) &&
          evidence.outcome === "passed",
      ),
    );
}

export function completeTask(
  aggregate: DevelopmentAggregate,
  commandValue: CompleteTaskCommand,
): DevelopmentCommandExecution {
  const command = completeTaskCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const task = aggregate.taskRuns[command.taskRunId];
  if (!task) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  if (task.status !== "verifying") {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  if (!requiredEvidenceMatches(aggregate, task, command.evidenceIds)) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "evidence_missing", {
        taskRunId: task.taskRunId,
      }),
    );
  }
  let next = updateTaskStatus(
    aggregate,
    command.requestId,
    task,
    "completed",
    command.completedAt,
    { evidenceIds: [...new Set(command.evidenceIds)] },
  );
  const currentAgentId = task.agentRunIds.at(-1);
  const agent = currentAgentId ? next.agentRuns[currentAgentId] : undefined;
  if (agent && canTransitionAgentRun(agent.status, "completed")) {
    const updatedAgent = agentRunSchema.parse({
      ...agent,
      status: "completed",
      completedAt: command.completedAt,
    });
    next = {
      ...next,
      agentRuns: { ...next.agentRuns, [agent.agentRunId]: updatedAgent },
      transitionHistory: [
        ...next.transitionHistory,
        transitionRecord(
          command.requestId,
          "agent_run",
          agent.agentRunId,
          agent.status,
          "completed",
          command.completedAt,
        ),
      ],
    };
  }
  const completedTask = next.taskRuns[task.taskRunId];
  if (completedTask) {
    next = progressAfterTaskCompletion(
      next,
      command.requestId,
      completedTask,
      command.completedAt,
    );
  }
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: task.taskRunId,
    }),
  );
}

function gateEvidenceSatisfied(
  aggregate: DevelopmentAggregate,
  phase: PhaseRun,
  requiredTypes: readonly EvidenceType[],
): boolean {
  const evidence = phase.taskRunIds.flatMap((id) => evidenceForTask(aggregate, id));
  return requiredTypes.every((type) =>
    evidence.some(
      (item) => item.type === mappedEvidenceType(type) && item.outcome === "passed",
    ),
  );
}

export function confirmPhaseGate(
  aggregate: DevelopmentAggregate,
  commandValue: ConfirmPhaseGateCommand,
): DevelopmentCommandExecution {
  const command = confirmPhaseGateCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const phase = aggregate.phaseRuns[command.phaseRunId];
  if (!phase) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_phase"),
    );
  }
  if (command.actorType !== "user") {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "user_actor_required", {
        phaseRunId: phase.phaseRunId,
      }),
    );
  }
  const gate = aggregate.executionPlan.userGates.find(
    (candidate) =>
      candidate.id === command.userGateId &&
      candidate.afterPhaseId === phase.executionPhaseId,
  );
  if (!gate) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "gate_mismatch", {
        phaseRunId: phase.phaseRunId,
      }),
    );
  }
  const existing = aggregate.gateHistory.find(
    (decision) =>
      decision.userGateId === gate.id && gateDecisionIsValid(aggregate, decision),
  );
  if (existing) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, true, "duplicate", {
        phaseRunId: phase.phaseRunId,
      }),
    );
  }
  if (
    phase.status !== "awaiting_gate" ||
    aggregate.run.status !== "awaiting_user_gate" ||
    !allPhaseTasksCompleted(aggregate, phase) ||
    !allRequiredTaskEvidencePresent(aggregate, phase) ||
    !gateEvidenceSatisfied(aggregate, phase, gate.requiredEvidenceTypes)
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "phase_exit_incomplete", {
        phaseRunId: phase.phaseRunId,
      }),
    );
  }
  const decision = phaseGateDecisionSchema.parse({
    decisionId: command.decisionId,
    requestId: command.requestId,
    developmentRunId: aggregate.run.developmentRunId,
    phaseRunId: phase.phaseRunId,
    userGateId: gate.id,
    actorType: "user",
    actorId: command.actorId,
    confirmedAt: command.confirmedAt,
  });
  let next: DevelopmentAggregate = {
    ...aggregate,
    gateHistory: [...aggregate.gateHistory, decision],
  };
  const phaseGates = next.executionPlan.userGates.filter(
    (candidate) => candidate.afterPhaseId === phase.executionPhaseId,
  );
  const allConfirmed = phaseGates.every((candidate) =>
    next.gateHistory.some(
      (item) =>
        item.userGateId === candidate.id && gateDecisionIsValid(next, item),
    ),
  );
  if (allConfirmed) {
    next = updatePhaseStatus(next, command.requestId, phase, "completed", command.confirmedAt);
    next = updateRunStatus(next, command.requestId, "running", command.confirmedAt);
    next = activateNextPhase(next, command.requestId, command.confirmedAt);
    if (Object.values(next.phaseRuns).every((item) => item.status === "completed")) {
      next = updateRunStatus(next, command.requestId, "completed", command.confirmedAt);
    }
  }
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      phaseRunId: phase.phaseRunId,
    }),
  );
}

function invalidationRecord(
  command: { requestId: string; invalidationIdPrefix: string },
  aggregate: DevelopmentAggregate,
  kind: DevelopmentInvalidationRecord["kind"],
  targetType: DevelopmentInvalidationRecord["targetType"],
  targetId: string,
  reason: string,
  at: string,
): DevelopmentInvalidationRecord {
  return developmentInvalidationRecordSchema.parse({
    invalidationId: `${command.invalidationIdPrefix}:${targetType}:${contentHash(targetId).slice(0, 20)}`,
    causedByRequestId: command.requestId,
    developmentRunId: aggregate.run.developmentRunId,
    kind,
    targetType,
    targetId,
    reason,
    invalidatedAt: at,
  });
}

function affectedEvidence(
  aggregate: DevelopmentAggregate,
  taskRunIds: ReadonlySet<string>,
): readonly VerificationEvidence[] {
  return aggregate.evidenceHistory.filter(
    (evidence) =>
      taskRunIds.has(evidence.taskRunId) &&
      !isInvalidated(aggregate, "evidence", evidence.evidenceId),
  );
}

export function markPlanningRevision(
  aggregate: DevelopmentAggregate,
  commandValue: PlanningRevisionCommand,
): DevelopmentCommandExecution {
  const command = planningRevisionCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  if (
    aggregate.run.status === "failed" ||
    aggregate.run.status === "cancelled" ||
    aggregate.run.status === "stale"
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status"),
    );
  }
  const roots =
    command.subjectType === "project_spec"
      ? [...aggregate.graph.taskOrder]
      : command.affectedTaskIds;
  if (
    roots.length === 0 ||
    roots.some((id) => !aggregate.graph.taskOrder.includes(id))
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  const affectedExecutionIds = dependentTaskIds(aggregate.graph, roots);
  const affectedRunIds = new Set(
    affectedExecutionIds.flatMap((id) => {
      const task = taskRunForExecutionId(aggregate, id);
      return task ? [task.taskRunId] : [];
    }),
  );
  const reason = `${command.subjectType} revised to ${command.newVersionId}`;
  const records: DevelopmentInvalidationRecord[] = [
    invalidationRecord(
      command,
      aggregate,
      "planning_revision",
      "run",
      aggregate.run.developmentRunId,
      reason,
      command.revisedAt,
    ),
  ];
  for (const id of affectedRunIds) {
    records.push(
      invalidationRecord(
        command,
        aggregate,
        "planning_revision",
        "task",
        id,
        reason,
        command.revisedAt,
      ),
    );
  }
  for (const evidence of affectedEvidence(aggregate, affectedRunIds)) {
    records.push(
      invalidationRecord(
        command,
        aggregate,
        "planning_revision",
        "evidence",
        evidence.evidenceId,
        reason,
        command.revisedAt,
      ),
    );
  }
  for (const decision of aggregate.gateHistory) {
    const phase = aggregate.phaseRuns[decision.phaseRunId];
    if (
      phase?.taskRunIds.some((id) => affectedRunIds.has(id)) &&
      gateDecisionIsValid(aggregate, decision)
    ) {
      records.push(
        invalidationRecord(
          command,
          aggregate,
          "planning_revision",
          "gate",
          decision.decisionId,
          reason,
          command.revisedAt,
        ),
      );
    }
  }

  let next: DevelopmentAggregate = {
    ...aggregate,
    invalidationHistory: [...aggregate.invalidationHistory, ...records],
  };
  for (const task of Object.values(next.taskRuns)) {
    if (affectedRunIds.has(task.taskRunId) && canTransitionTaskRun(task.status, "stale")) {
      next = updateTaskStatus(next, command.requestId, task, "stale", command.revisedAt);
    }
  }
  for (const phase of Object.values(next.phaseRuns)) {
    if (
      phase.taskRunIds.some((id) => affectedRunIds.has(id)) &&
      canTransitionPhaseRun(phase.status, "stale")
    ) {
      next = updatePhaseStatus(next, command.requestId, phase, "stale", command.revisedAt);
    }
  }
  for (const agent of Object.values(next.agentRuns)) {
    if (
      affectedRunIds.has(agent.taskRunId) &&
      canTransitionAgentRun(agent.status, "stale")
    ) {
      next = updateAgentStatus(
        next,
        command.requestId,
        agent,
        "stale",
        command.revisedAt,
      );
    }
  }
  next = updateRunStatus(next, command.requestId, "stale", command.revisedAt);
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted"),
  );
}

export function rerunTaskWithModel(
  aggregate: DevelopmentAggregate,
  commandValue: RerunTaskWithModelCommand,
): DevelopmentCommandExecution {
  const command = rerunTaskWithModelCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }
  const rootTask = aggregate.taskRuns[command.taskRunId];
  if (!rootTask) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "unknown_task"),
    );
  }
  if (aggregate.agentRuns[command.newAgentRunId]) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        taskRunId: rootTask.taskRunId,
      }),
    );
  }
  if (rootTask.modelSnapshotId === command.newModelSnapshotId) {
    return remember(
      aggregate,
      resultFor(
        aggregate,
        command.requestId,
        false,
        "model_snapshot_unchanged",
        { taskRunId: rootTask.taskRunId },
      ),
    );
  }
  if (
    !["running", "completed", "awaiting_user_gate", "needs_user_action"].includes(
      aggregate.run.status,
    ) ||
    !["completed", "failed", "blocked", "stale"].includes(rootTask.status)
  ) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status", {
        taskRunId: rootTask.taskRunId,
      }),
    );
  }
  const affectedExecutionIds = dependentTaskIds(aggregate.graph, [
    rootTask.executionTaskId,
  ]);
  const affectedRunIds = new Set(
    affectedExecutionIds.flatMap((id) => {
      const task = taskRunForExecutionId(aggregate, id);
      return task ? [task.taskRunId] : [];
    }),
  );
  const reason = `Model Snapshot changed to ${command.newModelSnapshotId}`;
  const records: DevelopmentInvalidationRecord[] = [];
  for (const id of affectedRunIds) {
    records.push(
      invalidationRecord(
        command,
        aggregate,
        "model_snapshot_changed",
        "task",
        id,
        reason,
        command.requestedAt,
      ),
    );
  }
  for (const evidence of affectedEvidence(aggregate, affectedRunIds)) {
    records.push(
      invalidationRecord(
        command,
        aggregate,
        "model_snapshot_changed",
        "evidence",
        evidence.evidenceId,
        reason,
        command.requestedAt,
      ),
    );
  }
  for (const decision of aggregate.gateHistory) {
    const phase = aggregate.phaseRuns[decision.phaseRunId];
    if (
      phase?.taskRunIds.some((id) => affectedRunIds.has(id)) &&
      gateDecisionIsValid(aggregate, decision)
    ) {
      records.push(
        invalidationRecord(
          command,
          aggregate,
          "model_snapshot_changed",
          "gate",
          decision.decisionId,
          reason,
          command.requestedAt,
        ),
      );
    }
  }
  let next: DevelopmentAggregate = {
    ...aggregate,
    invalidationHistory: [...aggregate.invalidationHistory, ...records],
  };
  for (const taskId of affectedExecutionIds) {
    const task = taskRunForExecutionId(next, taskId);
    if (!task) {
      continue;
    }
    const isRoot = task.taskRunId === rootTask.taskRunId;
    const targetStatus = isRoot ? "assembling_context" : "pending";
    next = resetTaskForRerun(
      next,
      command.requestId,
      task,
      targetStatus,
      command.requestedAt,
      isRoot
        ? {
            modelSnapshotId: command.newModelSnapshotId,
            agentRunIds: [...task.agentRunIds, command.newAgentRunId],
          }
        : {},
    );
  }
  for (const agent of Object.values(next.agentRuns)) {
    if (
      agent.agentRunId !== command.newAgentRunId &&
      affectedRunIds.has(agent.taskRunId) &&
      canTransitionAgentRun(agent.status, "stale")
    ) {
      next = updateAgentStatus(
        next,
        command.requestId,
        agent,
        "stale",
        command.requestedAt,
      );
    }
  }
  const newAgentRun = agentRunSchema.parse({
    agentRunId: command.newAgentRunId,
    developmentRunId: aggregate.run.developmentRunId,
    taskRunId: rootTask.taskRunId,
    purpose: "implementation",
    modelSnapshotId: command.newModelSnapshotId,
    status: "ready",
    createdAt: command.requestedAt,
  });
  next = {
    ...next,
    agentRuns: { ...next.agentRuns, [command.newAgentRunId]: newAgentRun },
  };

  const rootPhaseId = aggregate.graph.taskPhase[rootTask.executionTaskId];
  for (const phase of Object.values(next.phaseRuns)) {
    if (!phase.taskRunIds.some((id) => affectedRunIds.has(id))) {
      continue;
    }
    const targetStatus = phase.executionPhaseId === rootPhaseId ? "running" : "pending";
    next = resetPhaseForRerun(
      next,
      command.requestId,
      phase,
      targetStatus,
      command.requestedAt,
    );
  }
  const currentPhaseRunId = rootPhaseId
    ? phaseRunForExecutionId(next, rootPhaseId)?.phaseRunId
    : undefined;
  const runPointers = presentRunPointers(
    currentPhaseRunId,
    rootTask.taskRunId,
  );
  if (next.run.status !== "running") {
    next = updateRunStatus(
      next,
      command.requestId,
      "running",
      command.requestedAt,
      runPointers,
    );
  } else {
    next = {
      ...next,
      run: developmentRunSchema.parse({
        ...withoutCompletedAt(next.run),
        ...runPointers,
        updatedAt: command.requestedAt,
      }),
    };
  }
  return remember(
    next,
    resultFor(next, command.requestId, true, "accepted", {
      taskRunId: rootTask.taskRunId,
    }),
  );
}

export function controlDevelopmentRun(
  aggregate: DevelopmentAggregate,
  commandValue: DevelopmentControlCommand,
): DevelopmentCommandExecution {
  const command = developmentControlCommandSchema.parse(commandValue);
  const previous = previousExecution(aggregate, command.requestId);
  if (previous) {
    return previous;
  }

  const target =
    command.action === "pause"
      ? "paused"
      : command.action === "resume"
        ? "running"
        : "cancelled";
  if (!canTransitionDevelopmentRun(aggregate.run.status, target)) {
    return remember(
      aggregate,
      resultFor(aggregate, command.requestId, false, "invalid_status"),
    );
  }

  let next = updateRunStatus(
    aggregate,
    command.requestId,
    target,
    command.occurredAt,
  );
  if (command.action === "cancel") {
    for (const phase of Object.values(next.phaseRuns)) {
      if (canTransitionPhaseRun(phase.status, "cancelled")) {
        next = updatePhaseStatus(
          next,
          command.requestId,
          phase,
          "cancelled",
          command.occurredAt,
        );
      }
    }
    for (const task of Object.values(next.taskRuns)) {
      if (canTransitionTaskRun(task.status, "cancelled")) {
        next = updateTaskStatus(
          next,
          command.requestId,
          task,
          "cancelled",
          command.occurredAt,
        );
      }
    }
    for (const agent of Object.values(next.agentRuns)) {
      if (canTransitionAgentRun(agent.status, "cancelled")) {
        next = updateAgentStatus(
          next,
          command.requestId,
          agent,
          "cancelled",
          command.occurredAt,
        );
      }
    }
  }

  return remember(
    next,
    resultFor(
      next,
      command.requestId,
      true,
      "accepted",
      presentReferences(next.run.currentPhaseRunId, next.run.currentTaskRunId),
    ),
  );
}
