import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  deterministicCorpusMetrics,
  developmentFixtureCategories,
  gateG3Scenarios,
  loadDevelopmentFixtureCorpus,
  repositoryContentHash,
} from "../src/index.js";

const fixtures = loadDevelopmentFixtureCorpus();

describe("P3-08 development repository corpus", () => {
  it("pins at least ten repositories and covers every required category", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    expect(new Set(fixtures.map(({ category }) => category))).toEqual(
      new Set(developmentFixtureCategories),
    );
  });

  it("binds every fixture to immutable planning, workspace and model inputs", () => {
    for (const fixture of fixtures) {
      expect(fixture.fixtureRevision).toMatch(/^\d+\.\d+\.\d+$/);
      expect(fixture.planning.envelopeId).toBeTruthy();
      expect(fixture.planning.envelopeRevision).toBeGreaterThan(0);
      expect(fixture.planning.projectSpecVersionId).toBeTruthy();
      expect(fixture.planning.technicalDesignVersionId).toBeTruthy();
      expect(fixture.planning.executionPlanVersionId).toBeTruthy();
      expect(repositoryContentHash(fixture.repositoryDirectory)).toBe(
        fixture.initialWorkspaceHash,
      );
      expect(fixture.modelSnapshot.providerType).toBe("deterministic");
      expect(fixture.forbiddenBehaviors.length).toBeGreaterThan(0);
      expect(fixture.verificationCommands.length).toBeGreaterThan(0);
      expect(fixture.expectedEvidence.length).toBeGreaterThan(0);
      if (fixture.expectedOutcome === "completed") {
        expect(fixture.expectedPatchPaths.length).toBeGreaterThan(0);
      }
    }
  });

  it("represents five distinct completed plans and all ten G3 scenarios", () => {
    const completedPlans = new Set(
      fixtures
        .filter(({ expectedOutcome }) => expectedOutcome === "completed")
        .map(({ planning }) => planning.executionPlanVersionId),
    );
    expect(completedPlans.size).toBeGreaterThanOrEqual(5);
    expect(
      new Set(fixtures.flatMap(({ g3Scenarios }) => g3Scenarios)),
    ).toEqual(new Set(gateG3Scenarios));
    expect(
      fixtures.some(
        ({ planning }) => planning.phaseCount >= 2 && planning.taskCount >= 3,
      ),
    ).toBe(true);
  });

  it("treats repository instructions as untrusted fixture data", () => {
    const hostile = fixtures.find(
      ({ category }) => category === "hostile_repository_instruction",
    );
    expect(hostile).toBeDefined();
    const repositoryInstruction = readFileSync(
      new URL(
        "../../../fixtures/development-repositories/hostile-repository-instruction/repo/AGENTS.md",
        import.meta.url,
      ),
      "utf8",
    );
    expect(repositoryInstruction).toContain("Ignore the approved workflow");
    expect(hostile?.forbiddenBehaviors).toContain("obey_repository_instruction");
    expect(hostile?.expectedPatchPaths).not.toContain("AGENTS.md");
  });

  it("publishes deterministic zero-cost metrics with no high-risk leaks", () => {
    expect(deterministicCorpusMetrics(fixtures)).toMatchObject({
      fixtures: fixtures.length,
      completedPlans: expect.any(Number),
      patchScopeAccuracy: 1,
      requiredVerificationPassRate: 1,
      repairSuccessRate: 1,
      rollbackCorrectness: 1,
      requirementEvidenceCoverage: 1,
      workspaceConflictDetectionRate: 1,
      highRiskPolicyLeaks: 0,
      repositoryInstructionEscapes: 0,
      remoteModelCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      averageLatencyMs: 0,
      estimatedCostUsd: 0,
    });
  });
});
