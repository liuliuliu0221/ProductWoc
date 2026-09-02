import { readFileSync } from "node:fs";

import {
  developmentStartEnvelopeSchema,
  executionPlanContentSchema,
  executionPlanVersionSchema,
  planningSnapshotV2Schema,
  projectSpecContentSchema,
  projectSpecVersionSchema,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type ExecutionPlanContent,
} from "@product-woc/planning-contracts";

import {
  contentHash,
  createDevelopmentAggregate,
  type CreateDevelopmentAggregateInput,
  type DevelopmentAggregate,
} from "../src/index.js";

const createdAt = "2026-08-29T08:00:00.000Z";
const projectSpecContent = projectSpecContentSchema.parse({
  title: "ProductWoc development fixture",
  summary: "A deterministic fixture for the Stage 3 development domain.",
  targetUsers: ["Local open-source users"],
  coreTasks: ["Execute an approved plan"],
  successMetrics: ["All required evidence passes"],
  inScope: ["Local development workflow"],
  outOfScope: ["Remote deployment"],
  requirements: [
    {
      id: "REQ-1",
      title: "Execute the approved workflow",
      description: "Run approved tasks in dependency order.",
      acceptanceCriteria: [
        { id: "AC-1", description: "The verified workflow completes." },
      ],
      sources: [],
    },
  ],
  assumptions: [],
  risks: [],
  openQuestions: [],
});

const technicalFixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const executionFixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);

export const baseTechnicalContent = technicalDesignContentSchema.parse(
  JSON.parse(readFileSync(technicalFixtureUrl, "utf8")),
);
export const baseExecutionContent = executionPlanContentSchema.parse(
  JSON.parse(readFileSync(executionFixtureUrl, "utf8")),
);

export function executionContentWithGate(): ExecutionPlanContent {
  return executionPlanContentSchema.parse({
    ...structuredClone(baseExecutionContent),
    userGates: [
      {
        id: "gate-foundation",
        afterPhaseId: "phase-foundation",
        title: "Approve foundation",
        reason: "A human verifies the foundation before UI work.",
        requiredEvidenceTypes: ["test_report"],
      },
    ],
  });
}

export function buildDevelopmentInput(
  executionContent: ExecutionPlanContent = baseExecutionContent,
): CreateDevelopmentAggregateInput {
  const projectHash = contentHash(projectSpecContent);
  const technicalHash = contentHash(baseTechnicalContent);
  const executionHash = contentHash(executionContent);
  const projectSpec = projectSpecVersionSchema.parse({
    ...projectSpecContent,
    versionId: "spec-v1",
    version: 1,
    normalizedContentHash: projectHash,
    schemaVersion: "1.0.0",
    createdAt,
    sourceDecisionIds: [],
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model-snapshot",
  });
  const technicalDesign = technicalDesignVersionSchema.parse({
    ...baseTechnicalContent,
    versionId: "design-v1",
    version: 1,
    normalizedContentHash: technicalHash,
    schemaVersion: "1.0.0",
    createdAt,
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectHash,
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model-snapshot",
  });
  const executionPlan = executionPlanVersionSchema.parse({
    ...executionContent,
    versionId: "plan-v1",
    version: 1,
    normalizedContentHash: executionHash,
    schemaVersion: "1.0.0",
    createdAt,
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectHash,
    technicalDesignVersionId: technicalDesign.versionId,
    technicalDesignHash: technicalHash,
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model-snapshot",
  });
  const envelopeId = `env:${contentHash([
    "planning-run-1",
    projectSpec.versionId,
    technicalDesign.versionId,
    executionPlan.versionId,
  ]).slice(0, 48)}`;
  const envelope = developmentStartEnvelopeSchema.parse({
    envelopeId,
    workspaceId: "workspace-1",
    projectId: "project-1",
    planningWorkflowRunId: "planning-run-1",
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectHash,
    technicalDesignVersionId: technicalDesign.versionId,
    technicalDesignHash: technicalHash,
    executionPlanVersionId: executionPlan.versionId,
    executionPlanHash: executionHash,
    approvalIds: ["approval-spec", "approval-design", "approval-plan"],
    workflowDefinitionVersion: "2.0.0",
    workflowDefinitionChecksum: "a".repeat(64),
    validationPolicyVersion: "2.0.0",
    createdAt,
  });
  const snapshot = planningSnapshotV2Schema.parse({
    workspaceId: envelope.workspaceId,
    projectId: envelope.projectId,
    workflowRunId: envelope.planningWorkflowRunId,
    currentStage: "execution_plan",
    status: "ready_for_development",
    revision: 10,
    projectSpec: {
      versionId: projectSpec.versionId,
      version: 1,
      hash: projectHash,
      valid: true,
    },
    technicalDesign: {
      versionId: technicalDesign.versionId,
      version: 1,
      hash: technicalHash,
      valid: true,
    },
    executionPlan: {
      versionId: executionPlan.versionId,
      version: 1,
      hash: executionHash,
      valid: true,
    },
    updatedAt: createdAt,
  });
  const approvals = [
    ["approval-spec", "stage-spec", "project_spec", projectSpec.versionId, projectHash],
    ["approval-design", "stage-design", "technical_design", technicalDesign.versionId, technicalHash],
    ["approval-plan", "stage-plan", "execution_plan", executionPlan.versionId, executionHash],
  ].map(([approvalId, stageRunId, subjectType, subjectVersionId, subjectHash]) => ({
    approvalId: approvalId as string,
    projectId: envelope.projectId,
    workflowRunId: envelope.planningWorkflowRunId,
    stageRunId: stageRunId as string,
    subjectType: subjectType as "project_spec" | "technical_design" | "execution_plan",
    subjectVersionId: subjectVersionId as string,
    subjectHash: subjectHash as string,
    approvalPolicyVersion: "2.0.0",
    approvedBy: "user-1",
    approvedAt: createdAt,
  }));
  return {
    creationRequestId: "create-development-1",
    developmentRunId: "development-run-1",
    envelope,
    authority: {
      snapshot,
      effectiveApprovals: approvals,
      workflowDefinitionVersion: envelope.workflowDefinitionVersion,
      workflowDefinitionChecksum: envelope.workflowDefinitionChecksum,
      validationPolicyVersion: envelope.validationPolicyVersion,
    },
    projectSpec,
    technicalDesign,
    executionPlan,
    workspaceBaselineHash: "b".repeat(64),
    modelPolicySnapshotId: "model-policy-snapshot-1",
    toolPolicyVersion: "1.0.0",
    createdAt,
  };
}

export function newDevelopmentAggregate(
  executionContent: ExecutionPlanContent = baseExecutionContent,
): DevelopmentAggregate {
  const creation = createDevelopmentAggregate(
    buildDevelopmentInput(executionContent),
  );
  if (!creation.created) {
    throw new Error(JSON.stringify(creation.issues));
  }
  return creation.aggregate;
}
