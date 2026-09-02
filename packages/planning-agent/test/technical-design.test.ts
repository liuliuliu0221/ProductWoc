import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  technicalDesignContentSchema,
  type ApprovalBindingV2,
  type ProjectSpecVersion,
  type TechnicalDesignContent,
} from "@product-woc/planning-contracts";

import {
  generateTechnicalDesign,
  materializeTechnicalDesignVersion,
  type PlanningModelProvider,
  type PlanningModelRequest,
  type PlanningModelResponse,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const validContent = technicalDesignContentSchema.parse(
  JSON.parse(readFileSync(fixtureUrl, "utf8")),
);

const projectSpec: ProjectSpecVersion = {
  versionId: "spec-1",
  version: 1,
  normalizedContentHash: "a".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:00:00+08:00",
  title: "Fixture product",
  summary: "Implement a primary workflow",
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

const approval: ApprovalBindingV2 = {
  approvalId: "approval-spec-1",
  projectId: "project-1",
  workflowRunId: "run-1",
  stageRunId: "stage-spec-1",
  subjectType: "project_spec",
  subjectVersionId: projectSpec.versionId,
  subjectHash: projectSpec.normalizedContentHash,
  approvalPolicyVersion: "2.0.0",
  approvedBy: "user-1",
  approvedAt: "2026-08-28T00:01:00+08:00",
};

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
      modelSnapshot: "fixture-architect",
      output,
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
    };
  }
}

function generationInput() {
  return {
    requestId: "technical-design-1",
    projectId: "project-1",
    workflowRunId: "run-1",
    approvalPolicyVersion: "2.0.0",
    projectSpec,
    projectSpecApproval: approval,
    policy: { availablePlatformCapabilities: [] },
  } as const;
}

describe("Technical Design generation", () => {
  it("does not call a model for a mismatched Project Spec approval", async () => {
    const provider = new SequenceProvider([validContent]);
    const result = await generateTechnicalDesign(
      {
        ...generationInput(),
        projectSpecApproval: { ...approval, subjectHash: "b".repeat(64) },
      },
      provider,
    );

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "upstream_not_approved",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("repairs coverage errors and materializes exact upstream binding", async () => {
    const invalid = {
      ...validContent,
      traceability: [
        {
          requirementId: "REQ-UNKNOWN",
          disposition: "designed",
          designItemIds: ["DES-1"],
        },
      ],
    };
    const provider = new SequenceProvider([invalid, validContent]);
    const result = await generateTechnicalDesign(generationInput(), provider);
    if (result.status !== "success") {
      throw new Error("Expected a successful Technical Design fixture");
    }

    expect(provider.requests).toHaveLength(2);
    expect(result.requirementCoverage).toBe(1);
    expect(provider.requests[0]?.input).not.toHaveProperty("projectSpecApproval");
    const version = materializeTechnicalDesignVersion(
      result.content,
      projectSpec,
      {
        versionId: "design-1",
        version: 1,
        schemaVersion: "2.0.0",
        createdAt: "2026-08-28T00:02:00+08:00",
        sourceArtifactIds: ["artifact-design-1"],
        promptVersion: "1.0.0",
        modelSnapshot: result.modelSnapshot,
      },
      generationInput().policy,
    );

    expect(version).toMatchObject({
      projectSpecVersionId: "spec-1",
      projectSpecHash: "a".repeat(64),
      normalizedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("routes an unconfirmed golden-stack deviation to the user", async () => {
    const deviation: TechnicalDesignContent = {
      ...validContent,
      stack: validContent.stack.map((decision, index) =>
        index === 0
          ? {
              capability: "web_framework",
              selection: "Next.js 16",
              status: "requires_confirmation",
              rationale: "The model proposed another framework",
              proposedAlternative: "SvelteKit",
            }
          : decision,
      ),
    };
    const provider = new SequenceProvider([deviation]);
    const result = await generateTechnicalDesign(generationInput(), provider);

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "policy_validation_failed",
      candidate: deviation,
    });
    expect(provider.requests).toHaveLength(1);
  });
});
