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
} from "@product-woc/planning-contracts";
import {
  contentHash,
  createDevelopmentAggregate,
  startDevelopmentRun,
} from "@product-woc/development-domain";
import {
  newDurableDevelopmentCheckpoint,
  parseDurableDevelopmentCheckpoint,
  type DurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";

export const at = "2026-09-01T08:00:00.000Z";

export function checkpointFixture(): DurableDevelopmentCheckpoint {
  const technicalContent = technicalDesignContentSchema.parse(JSON.parse(readFileSync(
    new URL("../../../fixtures/technical-design-valid-v1.json", import.meta.url), "utf8",
  )));
  const executionContent = executionPlanContentSchema.parse(JSON.parse(readFileSync(
    new URL("../../../fixtures/execution-plan-valid-v1.json", import.meta.url), "utf8",
  )));
  const projectContent = projectSpecContentSchema.parse({
    title: "Development Lab fixture",
    summary: "A local interface fixture.",
    targetUsers: ["Local users"],
    coreTasks: ["Inspect development"],
    successMetrics: ["Web and CLI agree"],
    inScope: ["Local UI"],
    outOfScope: ["Remote operations"],
    requirements: [{
      id: "REQ-1",
      title: "Observe",
      description: "Observe the run.",
      acceptanceCriteria: [{ id: "AC-1", description: "State is consistent." }],
      sources: [],
    }],
    assumptions: [], risks: [], openQuestions: [],
  });
  const projectHash = contentHash(projectContent);
  const technicalHash = contentHash(technicalContent);
  const executionHash = contentHash(executionContent);
  const projectSpec = projectSpecVersionSchema.parse({
    ...projectContent, versionId: "spec-v1", version: 1,
    normalizedContentHash: projectHash, schemaVersion: "1.0.0", createdAt: at,
    sourceDecisionIds: [], sourceArtifactIds: [], promptVersion: "1.0.0", modelSnapshot: "planning-model",
  });
  const technicalDesign = technicalDesignVersionSchema.parse({
    ...technicalContent, versionId: "design-v1", version: 1,
    normalizedContentHash: technicalHash, schemaVersion: "1.0.0", createdAt: at,
    projectSpecVersionId: projectSpec.versionId, projectSpecHash: projectHash,
    sourceArtifactIds: [], promptVersion: "1.0.0", modelSnapshot: "planning-model",
  });
  const executionPlan = executionPlanVersionSchema.parse({
    ...executionContent, versionId: "plan-v1", version: 1,
    normalizedContentHash: executionHash, schemaVersion: "1.0.0", createdAt: at,
    projectSpecVersionId: projectSpec.versionId, projectSpecHash: projectHash,
    technicalDesignVersionId: technicalDesign.versionId, technicalDesignHash: technicalHash,
    sourceArtifactIds: [], promptVersion: "1.0.0", modelSnapshot: "planning-model",
  });
  const envelopeId = `env:${contentHash(["planning-run-1", "spec-v1", "design-v1", "plan-v1"]).slice(0, 48)}`;
  const envelope = developmentStartEnvelopeSchema.parse({
    envelopeId, workspaceId: "local-workspace", projectId: "demo-project",
    planningWorkflowRunId: "planning-run-1", projectSpecVersionId: "spec-v1",
    projectSpecHash: projectHash, technicalDesignVersionId: "design-v1",
    technicalDesignHash: technicalHash, executionPlanVersionId: "plan-v1",
    executionPlanHash: executionHash,
    approvalIds: ["approval-spec", "approval-design", "approval-plan"],
    workflowDefinitionVersion: "2.0.0", workflowDefinitionChecksum: "a".repeat(64),
    validationPolicyVersion: "2.0.0", createdAt: at,
  });
  const snapshot = planningSnapshotV2Schema.parse({
    workspaceId: "local-workspace", projectId: "demo-project", workflowRunId: "planning-run-1",
    currentStage: "execution_plan", status: "ready_for_development", revision: 10,
    projectSpec: { versionId: "spec-v1", version: 1, hash: projectHash, valid: true },
    technicalDesign: { versionId: "design-v1", version: 1, hash: technicalHash, valid: true },
    executionPlan: { versionId: "plan-v1", version: 1, hash: executionHash, valid: true }, updatedAt: at,
  });
  const subjects = [
    ["approval-spec", "stage-spec", "project_spec", "spec-v1", projectHash],
    ["approval-design", "stage-design", "technical_design", "design-v1", technicalHash],
    ["approval-plan", "stage-plan", "execution_plan", "plan-v1", executionHash],
  ] as const;
  const creation = createDevelopmentAggregate({
    creationRequestId: "create-development-lab", developmentRunId: "development-run-lab",
    envelope,
    authority: {
      snapshot,
      effectiveApprovals: subjects.map(([approvalId, stageRunId, subjectType, subjectVersionId, subjectHash]) => ({
        approvalId, projectId: "demo-project", workflowRunId: "planning-run-1", stageRunId,
        subjectType, subjectVersionId, subjectHash, approvalPolicyVersion: "2.0.0",
        approvedBy: "local-user", approvedAt: at,
      })),
      workflowDefinitionVersion: "2.0.0", workflowDefinitionChecksum: "a".repeat(64),
      validationPolicyVersion: "2.0.0",
    },
    projectSpec, technicalDesign, executionPlan, workspaceBaselineHash: "b".repeat(64),
    modelPolicySnapshotId: "model-policy-1", toolPolicyVersion: "1.0.0", createdAt: at,
  });
  if (!creation.created) throw new Error(JSON.stringify(creation.issues));
  const started = startDevelopmentRun(creation.aggregate, {
    requestId: "start-lab", startedAt: at,
  }).aggregate;
  return newDurableDevelopmentCheckpoint({ aggregate: started, workspaceHash: "c".repeat(64), createdAt: at });
}

export function richCheckpointFixture(): DurableDevelopmentCheckpoint {
  const checkpoint = checkpointFixture();
  const taskRunId = checkpoint.aggregate.run.currentTaskRunId!;
  const task = checkpoint.aggregate.taskRuns[taskRunId]!;
  return parseDurableDevelopmentCheckpoint({
    ...checkpoint,
    modelSnapshots: [{
      snapshotId: "model-snapshot-1", routeRequestId: "route-1", agentRunId: "agent-1",
      policyId: "policy-1", scope: "development.implementation", selectionSource: "stage_override",
      profile: { profileId: "local-profile", providerType: "deterministic", model: "fixture-v1", temperature: 0, maxOutputTokens: 4096, capabilities: { structuredOutput: true, toolCalling: false, vision: false, localOnly: true } },
      policyHash: "1".repeat(64), profileHash: "2".repeat(64), configurationHash: "3".repeat(64),
      promptVersion: "1.0.0", toolPolicyVersion: "1.0.0", contextHash: "4".repeat(64), createdAt: at,
    }],
    contextSnapshots: [{
      contextSnapshotId: "context-1", developmentRunId: checkpoint.developmentRunId,
      taskRunId, agentRunId: "agent-1", executionTaskId: task.executionTaskId,
      taskDefinitionHash: task.taskDefinitionHash, projectSpecVersionId: "spec-v1",
      technicalDesignVersionId: "design-v1", executionPlanVersionId: "plan-v1",
      allowedWritePaths: ["src/**"],
      blocks: [{ blockId: "block-1", kind: "execution_task", sourceId: task.executionTaskId, sourceHash: "5".repeat(64), content: "fixture", trust: "untrusted_reference", instructionAuthority: "none", inclusionReason: "current task", redacted: true, truncated: false }],
      sources: [{ sourceId: task.executionTaskId, sourceHash: "5".repeat(64), kind: "execution_task", includedBlockIds: ["block-1"], redacted: true, truncated: false }],
      excludedCategories: ["full_chat_history"], contextHash: "4".repeat(64), createdAt: at,
    }],
    verificationArtifacts: [{
      artifactId: "artifact-1", developmentRunId: checkpoint.developmentRunId,
      taskRunId, verificationStepId: "verify-1", source: "command_output",
      content: "all checks passed", contentHash: "6".repeat(64), byteLength: 17,
      truncated: false, redacted: true, createdAt: at,
    }],
  });
}
