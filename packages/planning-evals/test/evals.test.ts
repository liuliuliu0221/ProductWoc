import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  generateProjectSpec,
  prepareUntrustedReferences,
  type PlanningModelProvider,
  type PlanningModelRequest,
  type PlanningModelResponse,
} from "@product-woc/planning-agent";
import {
  executionPlanContentSchema,
  projectSpecVersionSchema,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type DiscoveryAnalysis,
  type ProjectSpecContent,
  type TechnicalDesignContent,
} from "@product-woc/planning-contracts";
import {
  applyClarificationResolution,
  resolveClarifications,
} from "@product-woc/planning-domain";

import {
  planningEvalFixtureSchema,
  scoreExecutionPlan,
  scorePlanningFixture,
  scoreTechnicalDesign,
  summarizePlanningEvalSuite,
  type PlanningEvalObservation,
  type PlanningEvalFixture,
} from "../src/index.js";

const fixtureUrl = new URL("../../../fixtures/planning-discovery-v1.json", import.meta.url);
const fixtures = planningEvalFixtureSchema.array().parse(
  JSON.parse(readFileSync(fixtureUrl, "utf8")),
);
const technicalFixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const executionFixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);

function analysisFor(fixture: PlanningEvalFixture): DiscoveryAnalysis {
  const questions = fixture.expectedQuestionTopics.map((topic, index) => ({
    id: `question-${index + 1}`,
    topic,
    question: `Clarify ${topic}?`,
    recommendedDefault: `Recommended default for ${topic}`,
    impact: `${topic} changes the MVP boundary`,
    blocking: true as const,
    score: 1 - index / 10,
  }));
  const supported = fixture.expectedSupportLevel === "supported";

  return {
    understanding: {
      summary: fixture.idea,
      targetUsers: ["Fixture target users"],
      coreTasks: ["Complete the primary workflow"],
      assumptions: [
        {
          id: "assumption-1",
          statement: fixture.expectedDecisions[0] ?? "Use the documented default",
          source: "recommended_default",
          overridable: true,
        },
      ],
      risks: fixture.forbiddenBehaviors,
      support: {
        level: fixture.expectedSupportLevel,
        reason: supported
          ? "Fits the supported product scope"
          : "Requires an unsupported or high-risk capability",
        ...(supported
          ? {}
          : { safeFallback: fixture.expectedDecisions[0] ?? "Use a safe prototype" }),
      },
      uncertainties: questions,
    },
    questions: supported ? questions : [],
    outcome: supported
      ? questions.length > 0
        ? "awaiting_clarification"
        : "ready_for_spec"
      : "needs_user_action",
  };
}

function projectSpecFor(fixture: PlanningEvalFixture): ProjectSpecContent {
  return {
    title: `Fixture ${fixture.id}`,
    summary: fixture.idea,
    targetUsers: ["Fixture target users"],
    coreTasks: ["Complete the primary workflow"],
    successMetrics: ["The primary workflow passes acceptance tests"],
    inScope: ["The primary workflow"],
    outOfScope: fixture.forbiddenBehaviors,
    requirements: [
      {
        id: "REQ-1",
        title: "Primary workflow",
        description: "The target user can complete the primary workflow.",
        acceptanceCriteria: [
          {
            id: "AC-1",
            description: "The workflow produces a visible deterministic result.",
          },
        ],
        sources: [],
      },
    ],
    assumptions: fixture.expectedDecisions,
    risks: fixture.forbiddenBehaviors,
    openQuestions: [],
  };
}

class FixtureSpecProvider implements PlanningModelProvider {
  public constructor(private readonly content: ProjectSpecContent) {}

  public async generate(
    _request: PlanningModelRequest,
  ): Promise<PlanningModelResponse> {
    return {
      provider: "eval-fixture",
      modelSnapshot: "eval-fixture-v1",
      output: this.content,
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    };
  }
}

describe("planning discovery eval baseline", () => {
  it("contains at least twenty multilingual cases and blocked edge cases", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.filter(({ shouldGenerateSpec }) => shouldGenerateSpec).length).toBeGreaterThanOrEqual(12);
    expect(fixtures.some(({ category }) => category === "unsupported")).toBe(true);
    expect(fixtures.some(({ category }) => category === "high_risk")).toBe(true);
    expect(fixtures.filter(({ category }) => category === "reference")).toHaveLength(3);
    expect(new Set(fixtures.map(({ language }) => language))).toEqual(
      new Set(["zh", "en", "mixed"]),
    );
  });

  it.each(fixtures)("scores $id against deterministic expectations", (fixture) => {
    const score = scorePlanningFixture(
      fixture,
      analysisFor(fixture),
      fixture.shouldGenerateSpec ? projectSpecFor(fixture) : undefined,
    );

    expect(score.score).toBe(1);
    expect(score.checks.every(({ passed }) => passed)).toBe(true);
  });

  it("produces a complete suite-level P2-07 quality report", () => {
    const observations: PlanningEvalObservation[] = fixtures.map((fixture) => {
      const analysis = analysisFor(fixture);
      return {
        fixture,
        discoveryScore: scorePlanningFixture(
          fixture,
          analysis,
          fixture.shouldGenerateSpec ? projectSpecFor(fixture) : undefined,
        ),
        firstPassSchemaValid: true,
        repairAttempts: 0,
        requiredUserAction: fixture.expectedSupportLevel !== "supported",
        invalidationValid: true,
        referenceOverrideViolations: 0,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
      };
    });
    const report = summarizePlanningEvalSuite(observations);

    expect(report).toMatchObject({
      fixtureCount: 20,
      meanScore: 1,
      firstPassSchemaRate: 1,
      invalidationAccuracy: 1,
      unsupportedDetectionRate: 1,
      referenceOverrideViolations: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      gatePassed: true,
    });
  });

  it("treats attachment, Memory and Blueprint fixtures as untrusted context", () => {
    const referenceFixtures = fixtures.filter(
      ({ referenceContexts }) => referenceContexts.length > 0,
    );
    const prepared = referenceFixtures.flatMap((fixture) =>
      prepareUntrustedReferences(
        fixture.referenceContexts.map((reference, index) => ({
          artifactId: `${fixture.id}-${reference.kind}-${index}`,
          contentHash: String(index + 1).repeat(64),
          summary: reference.summary,
        })),
      ),
    );

    expect(referenceFixtures).toHaveLength(3);
    expect(prepared.every(({ trust }) => trust === "untrusted")).toBe(true);
    expect(
      prepared.every(({ instructionPolicy }) => instructionPolicy === "never_follow"),
    ).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain("evil-secret");
  });

  it.each(fixtures.filter(({ shouldGenerateSpec }) => shouldGenerateSpec))(
    "generates a schema-valid Project Spec for $id",
    async (fixture) => {
      const initialAnalysis = analysisFor(fixture);
      const resolution = resolveClarifications(
        initialAnalysis,
        initialAnalysis.questions.map(({ id }) => ({
          questionId: id,
          useRecommendedDefault: true,
        })),
        {
          actorId: "eval-user",
          recordedAt: "2026-08-28T00:00:00+08:00",
        },
      );
      const analysis = applyClarificationResolution(initialAnalysis, resolution);
      const generated = await generateProjectSpec(
        {
          requestId: `generate-${fixture.id}`,
          idea: fixture.idea,
          decisions: resolution.decisions,
          analysis,
        },
        new FixtureSpecProvider(projectSpecFor(fixture)),
      );

      expect(generated.status).toBe("success");
    },
  );

  it.each(fixtures.filter(({ shouldGenerateSpec }) => shouldGenerateSpec))(
    "meets the Technical Design baseline for $id",
    (fixture) => {
      const specContent = projectSpecFor(fixture);
      const projectSpec = projectSpecVersionSchema.parse({
        ...specContent,
        versionId: `spec-${fixture.id}`,
        version: 1,
        normalizedContentHash: "a".repeat(64),
        schemaVersion: "2.0.0",
        createdAt: "2026-08-28T00:00:00+08:00",
        sourceDecisionIds: [],
        sourceArtifactIds: [],
        promptVersion: "1.0.0",
        modelSnapshot: "eval-fixture",
      });
      const technicalDesign: TechnicalDesignContent =
        technicalDesignContentSchema.parse(
          JSON.parse(readFileSync(technicalFixtureUrl, "utf8")),
        );
      const score = scoreTechnicalDesign(
        fixture.id,
        projectSpec,
        technicalDesign,
        { availablePlatformCapabilities: [] },
      );

      expect(score.score).toBe(1);
      expect(score.checks.every(({ passed }) => passed)).toBe(true);
    },
  );

  it.each(fixtures.filter(({ shouldGenerateSpec }) => shouldGenerateSpec))(
    "meets the Execution Plan baseline for $id",
    (fixture) => {
      const projectSpec = projectSpecVersionSchema.parse({
        ...projectSpecFor(fixture),
        versionId: `spec-${fixture.id}`,
        version: 1,
        normalizedContentHash: "a".repeat(64),
        schemaVersion: "2.0.0",
        createdAt: "2026-08-28T00:00:00+08:00",
        sourceDecisionIds: [],
        sourceArtifactIds: [],
        promptVersion: "1.0.0",
        modelSnapshot: "eval-fixture",
      });
      const technicalDesign = technicalDesignVersionSchema.parse({
        ...technicalDesignContentSchema.parse(
          JSON.parse(readFileSync(technicalFixtureUrl, "utf8")),
        ),
        versionId: `design-${fixture.id}`,
        version: 1,
        normalizedContentHash: "b".repeat(64),
        schemaVersion: "2.0.0",
        createdAt: "2026-08-28T00:01:00+08:00",
        projectSpecVersionId: projectSpec.versionId,
        projectSpecHash: projectSpec.normalizedContentHash,
        sourceArtifactIds: [],
        promptVersion: "1.0.0",
        modelSnapshot: "eval-fixture",
      });
      const executionPlan = executionPlanContentSchema.parse(
        JSON.parse(readFileSync(executionFixtureUrl, "utf8")),
      );
      const score = scoreExecutionPlan(
        fixture.id,
        projectSpec,
        technicalDesign,
        executionPlan,
        { confirmedDecisionIds: [] },
      );

      expect(score.score).toBe(1);
      expect(score.checks.every(({ passed }) => passed)).toBe(true);
    },
  );
});
