import { describe, expect, it } from "vitest";

import type {
  PlanningModelProvider,
  PlanningModelRequest,
  PlanningModelResponse,
} from "../src/index.js";
import {
  generateDiscovery,
  generateProjectSpec,
  materializeProjectSpecVersion,
} from "../src/index.js";

const validUnderstanding = {
  summary: "A lightweight customer feedback tracker",
  targetUsers: ["Product managers"],
  coreTasks: ["Capture feedback", "Triage feedback"],
  assumptions: [
    {
      id: "assumption-1",
      statement: "Only workspace members administer feedback",
      source: "recommended_default" as const,
      overridable: true,
    },
  ],
  risks: ["Duplicate submissions"],
  support: {
    level: "supported" as const,
    reason: "Fits the supported web application scope",
  },
  uncertainties: [],
};

const validContent = {
  title: "Customer feedback tracker",
  summary: "Collect and triage customer feedback in one workspace.",
  targetUsers: ["Product managers"],
  coreTasks: ["Capture feedback", "Triage feedback"],
  successMetrics: ["All new feedback receives a status within seven days"],
  inScope: ["Feedback capture", "Status-based triage"],
  outOfScope: ["Public roadmap"],
  requirements: [
    {
      id: "REQ-1",
      title: "Capture feedback",
      description: "Workspace members can record customer feedback.",
      acceptanceCriteria: [
        { id: "AC-1", description: "Required feedback fields are validated." },
      ],
      sources: [],
    },
  ],
  assumptions: ["Only workspace members administer feedback"],
  risks: ["Duplicate submissions"],
  openQuestions: [],
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
      modelSnapshot: "fixture-model",
      output,
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
    };
  }
}

describe("structured planning generation", () => {
  it("repairs invalid discovery output once and sends only minimal context", async () => {
    const provider = new SequenceProvider([{ summary: "incomplete" }, validUnderstanding]);
    const result = await generateDiscovery(
      {
        requestId: "discovery-1",
        idea: "Build a customer feedback tracker",
        decisions: [],
        referenceSummaries: [],
      },
      provider,
    );

    expect(result.status).toBe("success");
    expect(provider.requests).toHaveLength(2);
    expect(Object.keys(provider.requests[0]?.input ?? {}).sort()).toEqual([
      "decisions",
      "idea",
      "referenceSummaries",
    ]);
    expect(provider.requests[0]?.input).not.toHaveProperty("chatHistory");
    expect(provider.requests[0]?.input).not.toHaveProperty("rawArtifacts");
  });

  it("stops after the configured repair budget", async () => {
    const provider = new SequenceProvider([{ invalid: true }, { stillInvalid: true }]);
    const result = await generateDiscovery(
      {
        requestId: "discovery-invalid",
        idea: "Build something",
        decisions: [],
        maxRepairAttempts: 1,
      },
      provider,
    );

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "schema_validation_failed",
    });
    expect(result.artifacts).toHaveLength(2);
    expect(provider.requests).toHaveLength(2);
  });

  it("materializes a valid immutable Project Spec from content", async () => {
    const discoveryProvider = new SequenceProvider([validUnderstanding]);
    const discovery = await generateDiscovery(
      {
        requestId: "discovery-ready",
        idea: "Build a customer feedback tracker",
        decisions: [],
      },
      discoveryProvider,
    );
    if (discovery.status !== "success") {
      throw new Error("Expected successful discovery fixture");
    }

    const specProvider = new SequenceProvider([validContent]);
    const generated = await generateProjectSpec(
      {
        requestId: "spec-1",
        idea: "Build a customer feedback tracker",
        decisions: [],
        analysis: discovery.analysis,
      },
      specProvider,
    );
    if (generated.status !== "success") {
      throw new Error("Expected successful Project Spec fixture");
    }

    const version = materializeProjectSpecVersion(generated.content, {
      versionId: "spec-version-1",
      version: 1,
      schemaVersion: "2.0.0",
      createdAt: "2026-08-27T10:00:00+08:00",
      sourceDecisionIds: [],
      sourceArtifactIds: ["artifact-1"],
      promptVersion: "1.0.0",
      modelSnapshot: generated.modelSnapshot,
    });

    expect(version).toMatchObject({
      versionId: "spec-version-1",
      normalizedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      title: "Customer feedback tracker",
    });
    expect(specProvider.requests[0]?.input).not.toHaveProperty("workflowState");
    expect(specProvider.requests[0]?.input).not.toHaveProperty("approval");
  });

  it("does not generate a spec while discovery is blocked", async () => {
    const provider = new SequenceProvider([validContent]);
    const result = await generateProjectSpec(
      {
        requestId: "spec-blocked",
        idea: "Build a customer feedback tracker",
        decisions: [],
        analysis: {
          understanding: {
            ...validUnderstanding,
            uncertainties: [
              {
                id: "q-user",
                topic: "User",
                question: "Who is the primary user?",
                recommendedDefault: "Internal product teams",
                impact: "Changes permissions and workflow",
                blocking: true,
                score: 0.9,
              },
            ],
          },
          questions: [
            {
              id: "q-user",
              topic: "User",
              question: "Who is the primary user?",
              recommendedDefault: "Internal product teams",
              impact: "Changes permissions and workflow",
              blocking: true,
              score: 0.9,
            },
          ],
          outcome: "awaiting_clarification",
        },
      },
      provider,
    );

    expect(result).toMatchObject({
      status: "needs_user_action",
      reason: "discovery_not_ready",
    });
    expect(provider.requests).toHaveLength(0);
  });
});
