import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  executionPlanContentSchema,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type ApprovalBindingV2,
  type ExecutionPlanContent,
  type ProjectSpecVersion,
} from "@product-woc/planning-contracts";

import {
  generateExecutionPlan,
  materializeExecutionPlanVersion,
  type PlanningModelProvider,
  type PlanningModelRequest,
  type PlanningModelResponse,
} from "../src/index.js";

const executionFixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);
const technicalFixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const validContent = executionPlanContentSchema.parse(
  JSON.parse(readFileSync(executionFixtureUrl, "utf8")),
);
const technicalContent = technicalDesignContentSchema.parse(
  JSON.parse(readFileSync(technicalFixtureUrl, "utf8")),
);

const projectSpec: ProjectSpecVersion = {
  versionId: "spec-1",
  version: 1,
  normalizedContentHash: "a".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:00:00+08:00",
  title: "Fixture product",
  summary: "Implement the primary workflow",
  targetUsers: ["Workspace members"],
  coreTasks: ["Complete the primary workflow"],
  successMetrics: ["The workflow passes acceptance tests"],
  inScope: ["Primary workflow"],
  outOfScope: ["Public community"],
  requirements: [
    {
      id: "REQ-1",
      title: "Primary workflow",
      description: "A member can complete the primary workflow",
      acceptanceCriteria: [{ id: "AC-1", description: "The result is persisted" }],
      sources: [],
    },
  ],
  assumptions: [],
  risks: [],
  openQuestions: [],
  sourceDecisionIds: [],
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-model",
};
const technicalDesign = technicalDesignVersionSchema.parse({
  ...technicalContent,
  versionId: "design-1",
  version: 1,
  normalizedContentHash: "b".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:01:00+08:00",
  projectSpecVersionId: projectSpec.versionId,
  projectSpecHash: projectSpec.normalizedContentHash,
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-architect",
});

function approval(
  subjectType: "project_spec" | "technical_design",
): ApprovalBindingV2 {
  const design = subjectType === "technical_design";
  return {
    approvalId: `approval-${subjectType}-1`,
    projectId: "project-1",
    workflowRunId: "run-1",
    stageRunId: `stage-${subjectType}-1`,
    subjectType,
    subjectVersionId: design ? technicalDesign.versionId : projectSpec.versionId,
    subjectHash: design
      ? technicalDesign.normalizedContentHash
      : projectSpec.normalizedContentHash,
    approvalPolicyVersion: "2.0.0",
    approvedBy: "user-1",
    approvedAt: "2026-08-28T00:02:00+08:00",
  };
}

class SequenceProvider implements PlanningModelProvider {
  public readonly requests: PlanningModelRequest[] = [];
  private index = 0;

  public constructor(private readonly outputs: readonly unknown[]) {}

  public async generate(request: PlanningModelRequest): Promise<PlanningModelResponse> {
    this.requests.push(request);
    const output = this.outputs[Math.min(this.index, this.outputs.length - 1)];
    this.index += 1;
    return {
      provider: "fixture-provider",
      modelSnapshot: "fixture-planner",
      output,
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
    };
  }
}

function generationInput() {
  return {
    requestId: "execution-plan-1",
    projectId: "project-1",
    workflowRunId: "run-1",
    approvalPolicyVersion: "2.0.0",
    projectSpec,
    projectSpecApproval: approval("project_spec"),
    technicalDesign,
    technicalDesignApproval: approval("technical_design"),
    policy: { confirmedDecisionIds: [] },
  } as const;
}

describe("Execution Plan generation", () => {
  it("does not call a model when an upstream approval is invalid", async () => {
    const provider = new SequenceProvider([validContent]);
    const result = await generateExecutionPlan(
      {
        ...generationInput(),
        technicalDesignApproval: {
          ...approval("technical_design"),
          subjectHash: "f".repeat(64),
        },
      },
      provider,
    );

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "upstream_not_approved",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("repairs graph errors and materializes exact upstream bindings", async () => {
    const invalid: ExecutionPlanContent = structuredClone(validContent);
    invalid.tasks[0] = {
      ...invalid.tasks[0]!,
      dependsOn: ["task-primary-workflow"],
    };
    const provider = new SequenceProvider([invalid, validContent]);
    const result = await generateExecutionPlan(generationInput(), provider);
    if (result.status !== "success") {
      throw new Error("Expected a successful Execution Plan fixture");
    }

    expect(provider.requests).toHaveLength(2);
    expect(result).toMatchObject({
      requirementCoverage: 1,
      acceptanceCriterionCoverage: 1,
      reachableTaskCoverage: 1,
    });
    expect(provider.requests[0]?.input).not.toHaveProperty("projectSpecApproval");
    expect(provider.requests[0]?.input).not.toHaveProperty("technicalDesignApproval");
    const version = materializeExecutionPlanVersion(
      result.content,
      projectSpec,
      technicalDesign,
      {
        versionId: "plan-1",
        version: 1,
        schemaVersion: "2.0.0",
        createdAt: "2026-08-28T00:03:00+08:00",
        sourceArtifactIds: ["artifact-plan-1"],
        promptVersion: "1.0.0",
        modelSnapshot: result.modelSnapshot,
      },
      generationInput().policy,
    );

    expect(version).toMatchObject({
      projectSpecVersionId: "spec-1",
      projectSpecHash: "a".repeat(64),
      technicalDesignVersionId: "design-1",
      technicalDesignHash: "b".repeat(64),
      normalizedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("routes a high-risk external operation to user confirmation", async () => {
    const gated: ExecutionPlanContent = structuredClone(validContent);
    gated.tasks[1] = {
      ...gated.tasks[1]!,
      riskLevel: "high",
      externalOperation: {
        kind: "deployment",
        riskLevel: "high",
        disposition: "requires_user_confirmation",
        rationale: "Deployment changes an external production system",
      },
    };
    const provider = new SequenceProvider([gated]);
    const result = await generateExecutionPlan(generationInput(), provider);

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "policy_validation_failed",
      candidate: gated,
    });
    expect(provider.requests).toHaveLength(1);
  });
});
