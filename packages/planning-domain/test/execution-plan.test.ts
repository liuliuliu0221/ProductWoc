import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  executionPlanContentSchema,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type ExecutionPlanContent,
  type ProjectSpecVersion,
} from "@product-woc/planning-contracts";

import {
  applyExecutionPlanRevision,
  validateExecutionPlan,
} from "../src/index.js";

const executionFixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);
const technicalFixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);

const validPlan = executionPlanContentSchema.parse(
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
  outOfScope: ["Community publishing"],
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

function clonePlan(): ExecutionPlanContent {
  return executionPlanContentSchema.parse(structuredClone(validPlan));
}

describe("Execution Plan validation", () => {
  it("accepts an acyclic, reachable, fully covered plan", () => {
    expect(
      validateExecutionPlan(clonePlan(), projectSpec, technicalDesign, {
        confirmedDecisionIds: [],
      }),
    ).toEqual({
      valid: true,
      needsUserAction: false,
      issues: [],
      requirementCoverage: 1,
      acceptanceCriterionCoverage: 1,
      reachableTaskCoverage: 1,
    });
  });

  it("detects task cycles and unreachable tasks", () => {
    const plan = clonePlan();
    plan.tasks[0] = { ...plan.tasks[0]!, dependsOn: ["task-primary-workflow"] };
    const result = validateExecutionPlan(plan, projectSpec, technicalDesign, {
      confirmedDecisionIds: [],
    });

    expect(result.valid).toBe(false);
    expect(result.reachableTaskCoverage).toBe(0);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["task_cycle", "unreachable_task"]),
    );
  });

  it("rejects unknown and uncovered acceptance criteria", () => {
    const plan = clonePlan();
    plan.tasks = plan.tasks.map((task) => ({
      ...task,
      acceptanceCriterionIds: ["AC-UNKNOWN"],
    }));
    const result = validateExecutionPlan(plan, projectSpec, technicalDesign, {
      confirmedDecisionIds: [],
    });

    expect(result.acceptanceCriterionCoverage).toBe(0);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unknown_acceptance_criterion",
        "missing_acceptance_coverage",
      ]),
    );
  });

  it("routes high-risk external operations to user confirmation", () => {
    const plan = clonePlan();
    plan.tasks[1] = {
      ...plan.tasks[1]!,
      riskLevel: "high",
      externalOperation: {
        kind: "deployment",
        riskLevel: "high",
        disposition: "requires_user_confirmation",
        rationale: "Deployment changes an external production system",
      },
    };
    const result = validateExecutionPlan(plan, projectSpec, technicalDesign, {
      confirmedDecisionIds: [],
    });

    expect(result.needsUserAction).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "external_operation_requires_confirmation" }),
    );
  });

  it("accepts a confirmed external operation with a user gate", () => {
    const plan = clonePlan();
    plan.userGates = [
      {
        id: "gate-deploy",
        afterPhaseId: "phase-primary-workflow",
        title: "Approve deployment",
        reason: "Deployment is an external write",
        requiredEvidenceTypes: ["test_report", "manual_approval"],
      },
    ];
    plan.tasks[1] = {
      ...plan.tasks[1]!,
      riskLevel: "high",
      externalOperation: {
        kind: "deployment",
        riskLevel: "high",
        disposition: "approved_with_gate",
        rationale: "The product owner approved a gated deployment task",
        userGateId: "gate-deploy",
        confirmationDecisionId: "decision-deploy",
      },
    };
    const result = validateExecutionPlan(plan, projectSpec, technicalDesign, {
      confirmedDecisionIds: ["decision-deploy"],
    });

    expect(result.valid).toBe(true);
  });

  it("creates complete new content from a single-field revision", () => {
    const revised = applyExecutionPlanRevision(clonePlan(), {
      risks: ["A newly reviewed delivery risk"],
    });

    expect(revised.risks).toEqual(["A newly reviewed delivery risk"]);
    expect(validPlan.risks).not.toEqual(revised.risks);
  });
});
