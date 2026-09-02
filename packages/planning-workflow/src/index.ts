import type {
  ApprovalBindingV2,
  ExecutionPlanVersion,
  PlanningSnapshotV2,
  PlanningStatusV2,
  PlanningSubject,
  PlanningWorkflowInputV2,
  ProjectSpecVersion,
  TechnicalDesignVersion,
  DevelopmentStartEnvelope,
  DiscoveryAnalysis,
} from "@product-woc/planning-contracts";
import {
  planningContractManifest,
  planningWorkflowInputV2Schema,
} from "@product-woc/planning-contracts";
import {
  LocalDeterministicPlanningModelProvider,
  generateDiscovery,
  generateExecutionPlan,
  generateProjectSpec,
  generateTechnicalDesign,
  materializeExecutionPlanVersion,
  materializeProjectSpecVersion,
  materializeTechnicalDesignVersion,
  redactSensitiveText,
  type PlanningModelProvider,
} from "@product-woc/planning-agent";
import {
  CollectingPlanningEventPublisher,
  InMemoryApprovalRepository,
  InMemoryPlanningDocumentRepository,
  InMemoryPlanningRunRepository,
  SequenceClock,
  SequentialIdGenerator,
  type ApprovalRepository,
  type Clock,
  type IdGenerator,
  type PlanningDocumentRepository,
  type PlanningEventPublisher,
  type PlanningRunRepository,
} from "@product-woc/planning-adapters";
import {
  approvePlanningSubject,
  assertTransition,
  createPlanningAggregate,
  recordDocumentVersion,
  recordExecutionPlanVersion,
  recordTechnicalDesignVersion,
  validateDevelopmentStartEnvelope,
  type PlanningAggregate,
} from "@product-woc/planning-domain";

export * from "./durable.js";

export function transitionSnapshot(
  snapshot: PlanningSnapshotV2,
  status: PlanningStatusV2,
  updatedAt: string,
): PlanningSnapshotV2 {
  assertTransition(snapshot.status, status);
  return {
    ...snapshot,
    status,
    revision: snapshot.revision + 1,
    updatedAt,
  };
}

export interface StandalonePlanningRequest {
  workspaceId: string;
  projectId: string;
  requestedBy: string;
  requestId: string;
  idea: string;
}

export interface StandalonePlanningPorts {
  runs: PlanningRunRepository;
  documents: PlanningDocumentRepository;
  approvals: ApprovalRepository;
  events: PlanningEventPublisher;
  model: PlanningModelProvider;
  clock: Clock;
  ids: IdGenerator;
}

export interface InMemoryStandalonePlanningPorts extends StandalonePlanningPorts {
  runs: InMemoryPlanningRunRepository;
  documents: InMemoryPlanningDocumentRepository;
  approvals: InMemoryApprovalRepository;
  events: CollectingPlanningEventPublisher;
  model: LocalDeterministicPlanningModelProvider;
  clock: SequenceClock;
  ids: SequentialIdGenerator;
}

export interface StandalonePlanningResult {
  input: PlanningWorkflowInputV2;
  discovery: DiscoveryAnalysis;
  projectSpec: ProjectSpecVersion;
  technicalDesign: TechnicalDesignVersion;
  executionPlan: ExecutionPlanVersion;
  aggregate: PlanningAggregate;
  developmentStart: DevelopmentStartEnvelope;
}

export class StandalonePlanningError extends Error {
  public constructor(
    public readonly stage: PlanningSubject | "discovery",
    message: string,
  ) {
    super(message);
    this.name = "StandalonePlanningError";
  }
}

export function createInMemoryStandalonePlanningPorts(): InMemoryStandalonePlanningPorts {
  return {
    runs: new InMemoryPlanningRunRepository(),
    documents: new InMemoryPlanningDocumentRepository(),
    approvals: new InMemoryApprovalRepository(),
    events: new CollectingPlanningEventPublisher(),
    model: new LocalDeterministicPlanningModelProvider(),
    clock: new SequenceClock(),
    ids: new SequentialIdGenerator(),
  };
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

async function publishStatus(
  ports: StandalonePlanningPorts,
  snapshot: PlanningSnapshotV2,
): Promise<void> {
  await ports.runs.saveSnapshot(snapshot);
  await ports.events.publish({
    type: "planning.status_changed",
    projectId: snapshot.projectId,
    workflowRunId: snapshot.workflowRunId,
    stage: snapshot.currentStage,
    status: snapshot.status,
    revision: snapshot.revision,
    occurredAt: snapshot.updatedAt,
  });
}

async function approveCurrentSubject(
  ports: StandalonePlanningPorts,
  state: PlanningAggregate,
  subject: PlanningSubject,
  actorId: string,
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
    requestId: ports.ids.nextId(`approve-${subject}`),
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
  const approval = execution.state.effectiveApprovals[subject];
  if (!approval) {
    throw new StandalonePlanningError(subject, "Approval was not materialized");
  }
  await ports.approvals.append(approval);
  await publishStatus(ports, execution.state.snapshot);
  return execution.state;
}

/**
 * Runs the complete planning pipeline without ProductFac or external services.
 * Approvals are explicit local smoke-test approvals by `requestedBy`.
 */
export async function runAutoApprovedStandalonePlanning(
  request: StandalonePlanningRequest,
  ports: StandalonePlanningPorts = createInMemoryStandalonePlanningPorts(),
): Promise<StandalonePlanningResult> {
  const input = planningWorkflowInputV2Schema.parse({
    ...request,
    idea: redactSensitiveText(request.idea),
    workflowVersion: planningContractManifest.workflowVersion,
    approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
  });
  const existing = await ports.runs.getSnapshot(input.workspaceId, input.projectId);
  if (existing) {
    throw new StandalonePlanningError(
      "discovery",
      `A local planning run already exists for ${input.workspaceId}/${input.projectId}`,
    );
  }

  const workflowRunId = ports.ids.nextId("workflow-run");
  let snapshot: PlanningSnapshotV2 = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workflowRunId,
    currentStage: "discovery",
    status: "collecting_idea",
    revision: 0,
    updatedAt: ports.clock.now(),
  };
  await publishStatus(ports, snapshot);
  snapshot = transitionSnapshot(snapshot, "analyzing_request", ports.clock.now());
  await publishStatus(ports, snapshot);

  const discoveryResult = await generateDiscovery(
    {
      requestId: ports.ids.nextId("generate-discovery"),
      idea: input.idea,
      decisions: [],
    },
    ports.model,
  );
  if (discoveryResult.status !== "success") {
    throw new StandalonePlanningError(
      "discovery",
      discoveryResult.issues.join("; "),
    );
  }
  if (discoveryResult.analysis.outcome !== "ready_for_spec") {
    throw new StandalonePlanningError(
      "discovery",
      `Local run requires user action: ${discoveryResult.analysis.outcome}`,
    );
  }
  snapshot = {
    ...transitionSnapshot(snapshot, "generating_product_spec", ports.clock.now()),
    currentStage: "product_spec",
  };
  await publishStatus(ports, snapshot);
  let state = createPlanningAggregate(snapshot, {
    approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
    workflowDefinitionVersion: planningContractManifest.workflowVersion,
    workflowDefinitionChecksum: planningContractManifest.definitionChecksum,
    validationPolicyVersion: "2.0.0",
  });

  const specResult = await generateProjectSpec(
    {
      requestId: ports.ids.nextId("generate-project-spec"),
      idea: input.idea,
      decisions: [],
      analysis: discoveryResult.analysis,
    },
    ports.model,
  );
  if (specResult.status !== "success") {
    throw new StandalonePlanningError("project_spec", specResult.issues.join("; "));
  }
  const projectSpec = materializeProjectSpecVersion(specResult.content, {
    versionId: ports.ids.nextId("project-spec"),
    version: 1,
    schemaVersion: "2.0.0",
    createdAt: ports.clock.now(),
    sourceDecisionIds: [],
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: specResult.modelSnapshot,
  });
  await ports.documents.save("project_spec", projectSpec);
  let execution = recordDocumentVersion(state, {
    requestId: ports.ids.nextId("record-project-spec"),
    subjectType: "project_spec",
    versionId: projectSpec.versionId,
    version: projectSpec.version,
    subjectHash: projectSpec.normalizedContentHash,
    recordedAt: ports.clock.now(),
  });
  ensureAccepted("project_spec", execution.result.accepted, execution.result.reason);
  state = execution.state;
  await publishStatus(ports, state.snapshot);
  state = await approveCurrentSubject(ports, state, "project_spec", input.requestedBy);

  const specApproval = state.effectiveApprovals.project_spec as ApprovalBindingV2;
  const designResult = await generateTechnicalDesign(
    {
      requestId: ports.ids.nextId("generate-technical-design"),
      projectId: input.projectId,
      workflowRunId,
      approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
      projectSpec,
      projectSpecApproval: specApproval,
      policy: { availablePlatformCapabilities: [] },
    },
    ports.model,
  );
  if (designResult.status !== "success") {
    throw new StandalonePlanningError(
      "technical_design",
      designResult.issues.join("; "),
    );
  }
  const technicalDesign = materializeTechnicalDesignVersion(
    designResult.content,
    projectSpec,
    {
      versionId: ports.ids.nextId("technical-design"),
      version: 1,
      schemaVersion: "2.0.0",
      createdAt: ports.clock.now(),
      sourceArtifactIds: [],
      promptVersion: "1.0.0",
      modelSnapshot: designResult.modelSnapshot,
    },
    { availablePlatformCapabilities: [] },
  );
  await ports.documents.save("technical_design", technicalDesign);
  execution = recordTechnicalDesignVersion(
    state,
    ports.ids.nextId("record-technical-design"),
    technicalDesign,
    ports.clock.now(),
  );
  ensureAccepted("technical_design", execution.result.accepted, execution.result.reason);
  state = execution.state;
  await publishStatus(ports, state.snapshot);
  state = await approveCurrentSubject(
    ports,
    state,
    "technical_design",
    input.requestedBy,
  );

  const planResult = await generateExecutionPlan(
    {
      requestId: ports.ids.nextId("generate-execution-plan"),
      projectId: input.projectId,
      workflowRunId,
      approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
      projectSpec,
      projectSpecApproval: specApproval,
      technicalDesign,
      technicalDesignApproval: state.effectiveApprovals
        .technical_design as ApprovalBindingV2,
      policy: { confirmedDecisionIds: [] },
    },
    ports.model,
  );
  if (planResult.status !== "success") {
    throw new StandalonePlanningError(
      "execution_plan",
      planResult.issues.join("; "),
    );
  }
  const executionPlan = materializeExecutionPlanVersion(
    planResult.content,
    projectSpec,
    technicalDesign,
    {
      versionId: ports.ids.nextId("execution-plan"),
      version: 1,
      schemaVersion: "2.0.0",
      createdAt: ports.clock.now(),
      sourceArtifactIds: [],
      promptVersion: "1.0.0",
      modelSnapshot: planResult.modelSnapshot,
    },
    { confirmedDecisionIds: [] },
  );
  await ports.documents.save("execution_plan", executionPlan);
  execution = recordExecutionPlanVersion(
    state,
    ports.ids.nextId("record-execution-plan"),
    executionPlan,
    ports.clock.now(),
  );
  ensureAccepted("execution_plan", execution.result.accepted, execution.result.reason);
  state = execution.state;
  await publishStatus(ports, state.snapshot);
  state = await approveCurrentSubject(
    ports,
    state,
    "execution_plan",
    input.requestedBy,
  );

  const developmentStart = state.developmentStart;
  if (
    !developmentStart ||
    !validateDevelopmentStartEnvelope(state, developmentStart).valid
  ) {
    throw new StandalonePlanningError(
      "execution_plan",
      "A valid DevelopmentStartEnvelope was not created",
    );
  }
  return {
    input,
    discovery: discoveryResult.analysis,
    projectSpec,
    technicalDesign,
    executionPlan,
    aggregate: state,
    developmentStart,
  };
}
