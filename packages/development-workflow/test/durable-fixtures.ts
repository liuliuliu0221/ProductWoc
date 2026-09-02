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
  type DevelopmentStartEnvelope,
} from "@product-woc/planning-contracts";
import {
  contentHash,
  createDevelopmentAggregate,
  type DevelopmentAggregate,
} from "@product-woc/development-domain";

export const durableAt = "2026-08-29T16:00:00.000Z";

export function durableAggregateFixture(): {
  aggregate: DevelopmentAggregate;
  envelope: DevelopmentStartEnvelope;
} {
  const technicalContent = technicalDesignContentSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../fixtures/technical-design-valid-v1.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const executionContent = executionPlanContentSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../fixtures/execution-plan-valid-v1.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const projectContent = projectSpecContentSchema.parse({
    title: "Durable development fixture",
    summary: "Exercise restart-safe local development.",
    targetUsers: ["Local users"],
    coreTasks: ["Resume a task"],
    successMetrics: ["Recovery is deterministic"],
    inScope: ["Local checkpoints"],
    outOfScope: ["Remote deployment"],
    requirements: [
      {
        id: "REQ-1",
        title: "Recover",
        description: "Recover the active task.",
        acceptanceCriteria: [{ id: "AC-1", description: "Recovery is safe." }],
        sources: [],
      },
    ],
    assumptions: [],
    risks: [],
    openQuestions: [],
  });
  const projectHash = contentHash(projectContent);
  const technicalHash = contentHash(technicalContent);
  const executionHash = contentHash(executionContent);
  const projectSpec = projectSpecVersionSchema.parse({
    ...projectContent,
    versionId: "spec-v1",
    version: 1,
    normalizedContentHash: projectHash,
    schemaVersion: "1.0.0",
    createdAt: durableAt,
    sourceDecisionIds: [],
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model",
  });
  const technicalDesign = technicalDesignVersionSchema.parse({
    ...technicalContent,
    versionId: "design-v1",
    version: 1,
    normalizedContentHash: technicalHash,
    schemaVersion: "1.0.0",
    createdAt: durableAt,
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectHash,
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model",
  });
  const executionPlan = executionPlanVersionSchema.parse({
    ...executionContent,
    versionId: "plan-v1",
    version: 1,
    normalizedContentHash: executionHash,
    schemaVersion: "1.0.0",
    createdAt: durableAt,
    projectSpecVersionId: projectSpec.versionId,
    projectSpecHash: projectHash,
    technicalDesignVersionId: technicalDesign.versionId,
    technicalDesignHash: technicalHash,
    sourceArtifactIds: [],
    promptVersion: "1.0.0",
    modelSnapshot: "planning-model",
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
    createdAt: durableAt,
  });
  const snapshot = planningSnapshotV2Schema.parse({
    workspaceId: envelope.workspaceId,
    projectId: envelope.projectId,
    workflowRunId: envelope.planningWorkflowRunId,
    currentStage: "execution_plan",
    status: "ready_for_development",
    revision: 10,
    projectSpec: { versionId: projectSpec.versionId, version: 1, hash: projectHash, valid: true },
    technicalDesign: { versionId: technicalDesign.versionId, version: 1, hash: technicalHash, valid: true },
    executionPlan: { versionId: executionPlan.versionId, version: 1, hash: executionHash, valid: true },
    updatedAt: durableAt,
  });
  const subjects = [
    ["approval-spec", "stage-spec", "project_spec", projectSpec.versionId, projectHash],
    ["approval-design", "stage-design", "technical_design", technicalDesign.versionId, technicalHash],
    ["approval-plan", "stage-plan", "execution_plan", executionPlan.versionId, executionHash],
  ] as const;
  const creation = createDevelopmentAggregate({
    creationRequestId: "create-durable-development",
    developmentRunId: "development-run-durable",
    envelope,
    authority: {
      snapshot,
      effectiveApprovals: subjects.map(
        ([approvalId, stageRunId, subjectType, subjectVersionId, subjectHash]) => ({
          approvalId,
          projectId: envelope.projectId,
          workflowRunId: envelope.planningWorkflowRunId,
          stageRunId,
          subjectType,
          subjectVersionId,
          subjectHash,
          approvalPolicyVersion: "2.0.0",
          approvedBy: "local-user",
          approvedAt: durableAt,
        }),
      ),
      workflowDefinitionVersion: envelope.workflowDefinitionVersion,
      workflowDefinitionChecksum: envelope.workflowDefinitionChecksum,
      validationPolicyVersion: envelope.validationPolicyVersion,
    },
    projectSpec,
    technicalDesign,
    executionPlan,
    workspaceBaselineHash: "b".repeat(64),
    modelPolicySnapshotId: "model-policy-1",
    toolPolicyVersion: "1.0.0",
    createdAt: durableAt,
  });
  if (!creation.created) throw new Error(JSON.stringify(creation.issues));
  return { aggregate: creation.aggregate, envelope };
}
