import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  executionPlanContentSchema,
  executionPlanVersionSchema,
} from "@product-woc/planning-contracts";

import {
  renderExecutionPlanMarkdown,
  summarizeExecutionPlan,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);
const content = executionPlanContentSchema.parse(
  JSON.parse(readFileSync(fixtureUrl, "utf8")),
);
const version = executionPlanVersionSchema.parse({
  ...content,
  versionId: "plan-1",
  version: 1,
  normalizedContentHash: "c".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:02:00+08:00",
  projectSpecVersionId: "spec-1",
  projectSpecHash: "a".repeat(64),
  technicalDesignVersionId: "design-1",
  technicalDesignHash: "b".repeat(64),
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-planner",
});

describe("Execution Plan renderer", () => {
  it("renders bindings, graph, evidence, traceability, and rollback", () => {
    const markdown = renderExecutionPlanMarkdown(version);

    expect(markdown).toContain("Bound Project Spec: spec-1");
    expect(markdown).toContain("Bound Technical Design: design-1");
    expect(markdown).toContain("Depends on: task-foundation");
    expect(markdown).toContain("acceptance criteria AC-1");
    expect(markdown).toContain("[test_report] (required)");
    expect(markdown).toContain("## Rollback");
  });

  it("creates a compact approval summary", () => {
    expect(summarizeExecutionPlan(version)).toMatchObject({
      phaseCount: 2,
      phases: ["Foundation", "Primary workflow"],
      taskCount: 2,
      highRiskTasks: [],
      userGates: [],
      risks: ["Durable production adapters remain outside the standalone runtime"],
    });
  });
});
