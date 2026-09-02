import type {
  ApprovalBindingV2,
  ApprovePlanningSubjectCommand,
  DevelopmentStartEnvelope,
  ExecutionPlanVersion,
  InvalidationRecord,
  PlanningCommandResult,
  PlanningSnapshotV2,
  PlanningStatusV2,
  PlanningSubject,
  RecordDocumentVersionCommand,
  RejectProjectSpecCommand,
  ReturnToPlanningSubjectCommand,
  TechnicalDesignVersion,
} from "@product-woc/planning-contracts";
import { developmentStartEnvelopeSchema } from "@product-woc/planning-contracts";

import { validateApprovalBinding } from "./approval.js";
import { contentHash } from "./canonical-json.js";
import { invalidationTargetsFor } from "./invalidation.js";
import { canTransition } from "./state-machine.js";

type DocumentPointer = NonNullable<PlanningSnapshotV2["projectSpec"]>;

export interface PlanningAggregateConfig {
  approvalPolicyVersion: string;
  workflowDefinitionVersion: string;
  workflowDefinitionChecksum: string;
  validationPolicyVersion: string;
}

export interface PlanningAggregate {
  snapshot: PlanningSnapshotV2;
  config: PlanningAggregateConfig;
  effectiveApprovals: Partial<Record<PlanningSubject, ApprovalBindingV2>>;
  approvalHistory: readonly ApprovalBindingV2[];
  invalidations: readonly InvalidationRecord[];
  processedCommands: Readonly<Record<string, PlanningCommandResult>>;
  developmentStart?: DevelopmentStartEnvelope;
}

export interface PlanningCommandExecution {
  state: PlanningAggregate;
  result: PlanningCommandResult;
}

const generatingStatus: Record<PlanningSubject, PlanningStatusV2> = {
  project_spec: "generating_product_spec",
  technical_design: "generating_technical_design",
  execution_plan: "generating_execution_plan",
};

const awaitingStatus: Record<PlanningSubject, PlanningStatusV2> = {
  project_spec: "awaiting_product_spec_approval",
  technical_design: "awaiting_technical_design_approval",
  execution_plan: "awaiting_execution_plan_approval",
};

function pointerFor(
  snapshot: PlanningSnapshotV2,
  subject: PlanningSubject,
): DocumentPointer | undefined {
  switch (subject) {
    case "project_spec":
      return snapshot.projectSpec;
    case "technical_design":
      return snapshot.technicalDesign;
    case "execution_plan":
      return snapshot.executionPlan;
  }
}

function withPointer(
  snapshot: PlanningSnapshotV2,
  subject: PlanningSubject,
  pointer: DocumentPointer,
): PlanningSnapshotV2 {
  switch (subject) {
    case "project_spec":
      return { ...snapshot, projectSpec: pointer };
    case "technical_design":
      return { ...snapshot, technicalDesign: pointer };
    case "execution_plan":
      return { ...snapshot, executionPlan: pointer };
  }
}

function currentStageFor(subject: PlanningSubject): PlanningSnapshotV2["currentStage"] {
  return subject === "project_spec" ? "product_spec" : subject;
}

function nextStatusAfterApproval(subject: PlanningSubject): PlanningStatusV2 {
  switch (subject) {
    case "project_spec":
      return "generating_technical_design";
    case "technical_design":
      return "generating_execution_plan";
    case "execution_plan":
      return "ready_for_development";
  }
}

function nextStageAfterApproval(
  subject: PlanningSubject,
): PlanningSnapshotV2["currentStage"] {
  switch (subject) {
    case "project_spec":
      return "technical_design";
    case "technical_design":
      return "execution_plan";
    case "execution_plan":
      return "execution_plan";
  }
}

function resultFor(
  requestId: string,
  accepted: boolean,
  reason: PlanningCommandResult["reason"],
  status: PlanningStatusV2,
  subjectType: PlanningSubject,
  subjectVersionId?: string,
): PlanningCommandResult {
  return {
    requestId,
    accepted,
    reason,
    status,
    subjectType,
    ...(subjectVersionId ? { subjectVersionId } : {}),
  };
}

function rememberResult(
  state: PlanningAggregate,
  result: PlanningCommandResult,
): PlanningAggregate {
  return {
    ...state,
    processedCommands: {
      ...state.processedCommands,
      [result.requestId]: result,
    },
  };
}

function hasValidApproval(
  state: PlanningAggregate,
  subject: PlanningSubject,
): boolean {
  const pointer = pointerFor(state.snapshot, subject);
  const approval = state.effectiveApprovals[subject];
  if (!pointer?.valid || !approval) {
    return false;
  }

  return validateApprovalBinding(approval, {
    projectId: state.snapshot.projectId,
    workflowRunId: state.snapshot.workflowRunId,
    subjectType: subject,
    versionId: pointer.versionId,
    hash: pointer.hash,
    approvalPolicyVersion: state.config.approvalPolicyVersion,
  }).valid;
}

function upstreamApprovalsAreValid(
  state: PlanningAggregate,
  subject: PlanningSubject,
): boolean {
  if (subject === "project_spec") {
    return true;
  }
  if (subject === "technical_design") {
    return hasValidApproval(state, "project_spec");
  }
  return (
    hasValidApproval(state, "project_spec") &&
    hasValidApproval(state, "technical_design")
  );
}

export function createPlanningAggregate(
  snapshot: PlanningSnapshotV2,
  config: PlanningAggregateConfig,
): PlanningAggregate {
  return {
    snapshot,
    config,
    effectiveApprovals: {},
    approvalHistory: [],
    invalidations: [],
    processedCommands: {},
  };
}

export function returnToPlanningSubject(
  state: PlanningAggregate,
  command: ReturnToPlanningSubjectCommand,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[command.requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  const targetStatus = generatingStatus[command.subjectType];
  const pointer = pointerFor(state.snapshot, command.subjectType);
  if (state.snapshot.status === targetStatus) {
    const result = resultFor(
      command.requestId,
      true,
      "duplicate",
      state.snapshot.status,
      command.subjectType,
      pointer?.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  if (!canTransition(state.snapshot.status, targetStatus)) {
    const result = resultFor(
      command.requestId,
      false,
      "invalid_stage",
      state.snapshot.status,
      command.subjectType,
      pointer?.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  const snapshot: PlanningSnapshotV2 = {
    ...state.snapshot,
    currentStage: currentStageFor(command.subjectType),
    status: targetStatus,
    revision: state.snapshot.revision + 1,
    updatedAt: command.returnedAt,
  };
  const result = resultFor(
    command.requestId,
    true,
    "accepted",
    targetStatus,
    command.subjectType,
    pointer?.versionId,
  );
  return {
    state: rememberResult({ ...state, snapshot }, result),
    result,
  };
}

export function rejectProjectSpec(
  state: PlanningAggregate,
  command: RejectProjectSpecCommand,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[command.requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  if (state.snapshot.status !== "awaiting_product_spec_approval") {
    const result = resultFor(
      command.requestId,
      false,
      "not_awaiting_approval",
      state.snapshot.status,
      "project_spec",
      state.snapshot.projectSpec?.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  const snapshot: PlanningSnapshotV2 = {
    ...state.snapshot,
    status: "cancelled",
    revision: state.snapshot.revision + 1,
    updatedAt: command.rejectedAt,
  };
  const result = resultFor(
    command.requestId,
    true,
    "accepted",
    snapshot.status,
    "project_spec",
    snapshot.projectSpec?.versionId,
  );
  return {
    state: rememberResult({ ...state, snapshot }, result),
    result,
  };
}

export function recordDocumentVersion(
  state: PlanningAggregate,
  command: RecordDocumentVersionCommand,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[command.requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  if (state.snapshot.status !== generatingStatus[command.subjectType]) {
    const result = resultFor(
      command.requestId,
      false,
      "invalid_stage",
      state.snapshot.status,
      command.subjectType,
      command.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  if (!upstreamApprovalsAreValid(state, command.subjectType)) {
    const result = resultFor(
      command.requestId,
      false,
      "missing_upstream_approval",
      state.snapshot.status,
      command.subjectType,
      command.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  const currentPointer = pointerFor(state.snapshot, command.subjectType);
  if (currentPointer && command.version <= currentPointer.version) {
    const sameVersion =
      command.version === currentPointer.version &&
      command.versionId === currentPointer.versionId &&
      command.subjectHash === currentPointer.hash;
    const result = resultFor(
      command.requestId,
      sameVersion,
      sameVersion ? "duplicate" : "version_not_monotonic",
      state.snapshot.status,
      command.subjectType,
      command.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  let snapshot = state.snapshot;
  const approvals = { ...state.effectiveApprovals };
  const newInvalidations: InvalidationRecord[] = [];

  for (const target of invalidationTargetsFor(command.subjectType)) {
    const invalidatedPointer = pointerFor(snapshot, target.subject);
    const invalidatedApproval = approvals[target.subject];
    if (!invalidatedPointer && !invalidatedApproval) {
      continue;
    }

    if (target.invalidateDocument && invalidatedPointer?.valid) {
      snapshot = withPointer(snapshot, target.subject, {
        ...invalidatedPointer,
        valid: false,
      });
    }
    if (target.invalidateApproval) {
      delete approvals[target.subject];
    }

    newInvalidations.push({
      invalidationId: `inv:${contentHash([
        command.requestId,
        target.subject,
      ]).slice(0, 48)}`,
      causedByRequestId: command.requestId,
      changedSubjectType: command.subjectType,
      invalidatedSubjectType: target.subject,
      ...(invalidatedPointer
        ? { invalidatedVersionId: invalidatedPointer.versionId }
        : {}),
      ...(invalidatedApproval
        ? { invalidatedApprovalId: invalidatedApproval.approvalId }
        : {}),
      reason:
        target.subject === command.subjectType
          ? "subject_content_changed"
          : "upstream_content_changed",
      invalidatedAt: command.recordedAt,
    });
  }

  snapshot = withPointer(snapshot, command.subjectType, {
    versionId: command.versionId,
    version: command.version,
    hash: command.subjectHash,
    valid: true,
  });
  snapshot = {
    ...snapshot,
    currentStage: currentStageFor(command.subjectType),
    status: awaitingStatus[command.subjectType],
    revision: snapshot.revision + 1,
    updatedAt: command.recordedAt,
  };

  const result = resultFor(
    command.requestId,
    true,
    "accepted",
    snapshot.status,
    command.subjectType,
    command.versionId,
  );
  const nextState = rememberResult(
    {
      ...state,
      snapshot,
      effectiveApprovals: approvals,
      invalidations: [...state.invalidations, ...newInvalidations],
    },
    result,
  );
  const { developmentStart: _discarded, ...stateWithoutDevelopmentStart } = nextState;

  return { state: stateWithoutDevelopmentStart, result };
}

export function recordTechnicalDesignVersion(
  state: PlanningAggregate,
  requestId: string,
  version: TechnicalDesignVersion,
  recordedAt: string,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  const projectSpec = state.snapshot.projectSpec;
  if (
    !projectSpec?.valid ||
    version.projectSpecVersionId !== projectSpec.versionId ||
    version.projectSpecHash !== projectSpec.hash
  ) {
    const result = resultFor(
      requestId,
      false,
      "upstream_binding_mismatch",
      state.snapshot.status,
      "technical_design",
      version.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  return recordDocumentVersion(state, {
    requestId,
    subjectType: "technical_design",
    versionId: version.versionId,
    version: version.version,
    subjectHash: version.normalizedContentHash,
    recordedAt,
  });
}

export function recordExecutionPlanVersion(
  state: PlanningAggregate,
  requestId: string,
  version: ExecutionPlanVersion,
  recordedAt: string,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  const projectSpec = state.snapshot.projectSpec;
  const technicalDesign = state.snapshot.technicalDesign;
  if (
    !projectSpec?.valid ||
    !technicalDesign?.valid ||
    version.projectSpecVersionId !== projectSpec.versionId ||
    version.projectSpecHash !== projectSpec.hash ||
    version.technicalDesignVersionId !== technicalDesign.versionId ||
    version.technicalDesignHash !== technicalDesign.hash
  ) {
    const result = resultFor(
      requestId,
      false,
      "upstream_binding_mismatch",
      state.snapshot.status,
      "execution_plan",
      version.versionId,
    );
    return { state: rememberResult(state, result), result };
  }

  return recordDocumentVersion(state, {
    requestId,
    subjectType: "execution_plan",
    versionId: version.versionId,
    version: version.version,
    subjectHash: version.normalizedContentHash,
    recordedAt,
  });
}

export type DevelopmentStartValidationIssue =
  | "invalid_envelope"
  | "workflow_not_ready"
  | "aggregate_identity_mismatch"
  | "document_binding_mismatch"
  | "approval_binding_mismatch"
  | "workflow_definition_mismatch"
  | "validation_policy_mismatch"
  | "envelope_identity_mismatch";

export interface DevelopmentStartValidationResult {
  valid: boolean;
  issues: readonly DevelopmentStartValidationIssue[];
}

export function validateDevelopmentStartEnvelope(
  state: PlanningAggregate,
  envelope: DevelopmentStartEnvelope,
): DevelopmentStartValidationResult {
  const issues: DevelopmentStartValidationIssue[] = [];
  if (!developmentStartEnvelopeSchema.safeParse(envelope).success) {
    return { valid: false, issues: ["invalid_envelope"] };
  }
  if (state.snapshot.status !== "ready_for_development") {
    issues.push("workflow_not_ready");
  }
  if (
    envelope.workspaceId !== state.snapshot.workspaceId ||
    envelope.projectId !== state.snapshot.projectId ||
    envelope.planningWorkflowRunId !== state.snapshot.workflowRunId
  ) {
    issues.push("aggregate_identity_mismatch");
  }

  const projectSpec = state.snapshot.projectSpec;
  const technicalDesign = state.snapshot.technicalDesign;
  const executionPlan = state.snapshot.executionPlan;
  if (
    !projectSpec?.valid ||
    !technicalDesign?.valid ||
    !executionPlan?.valid ||
    envelope.projectSpecVersionId !== projectSpec.versionId ||
    envelope.projectSpecHash !== projectSpec.hash ||
    envelope.technicalDesignVersionId !== technicalDesign.versionId ||
    envelope.technicalDesignHash !== technicalDesign.hash ||
    envelope.executionPlanVersionId !== executionPlan.versionId ||
    envelope.executionPlanHash !== executionPlan.hash
  ) {
    issues.push("document_binding_mismatch");
  }

  const subjects: readonly PlanningSubject[] = [
    "project_spec",
    "technical_design",
    "execution_plan",
  ];
  const approvalsValid = subjects.every((subject, index) => {
    const pointer = pointerFor(state.snapshot, subject);
    const approval = state.effectiveApprovals[subject];
    return (
      pointer?.valid === true &&
      approval !== undefined &&
      envelope.approvalIds[index] === approval.approvalId &&
      validateApprovalBinding(approval, {
        projectId: state.snapshot.projectId,
        workflowRunId: state.snapshot.workflowRunId,
        subjectType: subject,
        versionId: pointer.versionId,
        hash: pointer.hash,
        approvalPolicyVersion: state.config.approvalPolicyVersion,
      }).valid
    );
  });
  if (!approvalsValid) {
    issues.push("approval_binding_mismatch");
  }
  if (
    envelope.workflowDefinitionVersion !== state.config.workflowDefinitionVersion ||
    envelope.workflowDefinitionChecksum !== state.config.workflowDefinitionChecksum
  ) {
    issues.push("workflow_definition_mismatch");
  }
  if (envelope.validationPolicyVersion !== state.config.validationPolicyVersion) {
    issues.push("validation_policy_mismatch");
  }

  if (projectSpec && technicalDesign && executionPlan) {
    const expectedId = `env:${contentHash([
      state.snapshot.workflowRunId,
      projectSpec.versionId,
      technicalDesign.versionId,
      executionPlan.versionId,
    ]).slice(0, 48)}`;
    if (envelope.envelopeId !== expectedId) {
      issues.push("envelope_identity_mismatch");
    }
  }

  return { valid: issues.length === 0, issues };
}

function createDevelopmentStartEnvelope(
  state: PlanningAggregate,
  approvals: Partial<Record<PlanningSubject, ApprovalBindingV2>>,
  createdAt: string,
): DevelopmentStartEnvelope | undefined {
  const projectSpec = state.snapshot.projectSpec;
  const technicalDesign = state.snapshot.technicalDesign;
  const executionPlan = state.snapshot.executionPlan;
  const projectSpecApproval = approvals.project_spec;
  const technicalDesignApproval = approvals.technical_design;
  const executionPlanApproval = approvals.execution_plan;

  if (
    !projectSpec?.valid ||
    !technicalDesign?.valid ||
    !executionPlan?.valid ||
    !projectSpecApproval ||
    !technicalDesignApproval ||
    !executionPlanApproval
  ) {
    return undefined;
  }

  const identity = [
    state.snapshot.workflowRunId,
    projectSpec.versionId,
    technicalDesign.versionId,
    executionPlan.versionId,
  ];

  const envelope: DevelopmentStartEnvelope = {
    envelopeId: `env:${contentHash(identity).slice(0, 48)}`,
    workspaceId: state.snapshot.workspaceId,
    projectId: state.snapshot.projectId,
    planningWorkflowRunId: state.snapshot.workflowRunId,
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectSpec.hash,
    technicalDesignVersionId: technicalDesign.versionId,
    technicalDesignHash: technicalDesign.hash,
    executionPlanVersionId: executionPlan.versionId,
    executionPlanHash: executionPlan.hash,
    approvalIds: [
      projectSpecApproval.approvalId,
      technicalDesignApproval.approvalId,
      executionPlanApproval.approvalId,
    ],
    workflowDefinitionVersion: state.config.workflowDefinitionVersion,
    workflowDefinitionChecksum: state.config.workflowDefinitionChecksum,
    validationPolicyVersion: state.config.validationPolicyVersion,
    createdAt,
  };
  return validateDevelopmentStartEnvelope(state, envelope).valid
    ? envelope
    : undefined;
}

export function approvePlanningSubject(
  state: PlanningAggregate,
  command: ApprovePlanningSubjectCommand,
): PlanningCommandExecution {
  const previousResult = state.processedCommands[command.requestId];
  if (previousResult) {
    return { state, result: previousResult };
  }

  const existingApproval = state.effectiveApprovals[command.subjectType];
  if (
    existingApproval?.subjectVersionId === command.subjectVersionId &&
    existingApproval.subjectHash === command.subjectHash
  ) {
    const result = resultFor(
      command.requestId,
      true,
      "duplicate",
      state.snapshot.status,
      command.subjectType,
      command.subjectVersionId,
    );
    return { state: rememberResult(state, result), result };
  }

  if (state.snapshot.status !== awaitingStatus[command.subjectType]) {
    const result = resultFor(
      command.requestId,
      false,
      "not_awaiting_approval",
      state.snapshot.status,
      command.subjectType,
      command.subjectVersionId,
    );
    return { state: rememberResult(state, result), result };
  }

  if (command.approvalPolicyVersion !== state.config.approvalPolicyVersion) {
    const result = resultFor(
      command.requestId,
      false,
      "policy_mismatch",
      state.snapshot.status,
      command.subjectType,
      command.subjectVersionId,
    );
    return { state: rememberResult(state, result), result };
  }

  const pointer = pointerFor(state.snapshot, command.subjectType);
  if (
    !pointer?.valid ||
    pointer.versionId !== command.subjectVersionId ||
    pointer.hash !== command.subjectHash
  ) {
    const result = resultFor(
      command.requestId,
      false,
      "subject_mismatch",
      state.snapshot.status,
      command.subjectType,
      command.subjectVersionId,
    );
    return { state: rememberResult(state, result), result };
  }

  if (!upstreamApprovalsAreValid(state, command.subjectType)) {
    const result = resultFor(
      command.requestId,
      false,
      "missing_upstream_approval",
      state.snapshot.status,
      command.subjectType,
      command.subjectVersionId,
    );
    return { state: rememberResult(state, result), result };
  }

  const approval: ApprovalBindingV2 = {
    approvalId: command.approvalId,
    projectId: state.snapshot.projectId,
    workflowRunId: state.snapshot.workflowRunId,
    stageRunId: command.stageRunId,
    subjectType: command.subjectType,
    subjectVersionId: command.subjectVersionId,
    subjectHash: command.subjectHash,
    approvalPolicyVersion: command.approvalPolicyVersion,
    approvedBy: command.actorId,
    approvedAt: command.approvedAt,
  };
  const approvals = {
    ...state.effectiveApprovals,
    [command.subjectType]: approval,
  };
  const nextStatus = nextStatusAfterApproval(command.subjectType);
  const snapshot: PlanningSnapshotV2 = {
    ...state.snapshot,
    currentStage: nextStageAfterApproval(command.subjectType),
    status: nextStatus,
    revision: state.snapshot.revision + 1,
    updatedAt: command.approvedAt,
  };
  const result = resultFor(
    command.requestId,
    true,
    "accepted",
    nextStatus,
    command.subjectType,
    command.subjectVersionId,
  );
  let nextState = rememberResult(
    {
      ...state,
      snapshot,
      effectiveApprovals: approvals,
      approvalHistory: [...state.approvalHistory, approval],
    },
    result,
  );

  if (command.subjectType === "execution_plan") {
    const developmentStart = createDevelopmentStartEnvelope(
      nextState,
      approvals,
      command.approvedAt,
    );
    if (!developmentStart) {
      const rejected = resultFor(
        command.requestId,
        false,
        "missing_upstream_approval",
        state.snapshot.status,
        command.subjectType,
        command.subjectVersionId,
      );
      return { state: rememberResult(state, rejected), result: rejected };
    }
    nextState = { ...nextState, developmentStart };
  }

  return { state: nextState, result };
}
