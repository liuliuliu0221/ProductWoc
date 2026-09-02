import { describe, expect, it } from "vitest";

import { runPlanningLab } from "../src/index.js";

describe("standalone planning lab", () => {
  it("runs from an idea to a rendered DevelopmentStartEnvelope", async () => {
    const output = await runPlanningLab({
      workspaceId: "workspace-e2e",
      projectId: "project-e2e",
      requestedBy: "user-e2e",
      requestId: "request-e2e",
      idea: "Build a private issue tracker",
    });

    expect(output.result.aggregate.snapshot.status).toBe("ready_for_development");
    expect(output.result.aggregate.approvalHistory).toHaveLength(3);
    expect(output.result.developmentStart).toMatchObject({
      projectId: "project-e2e",
      projectSpecVersionId: output.result.projectSpec.versionId,
      technicalDesignVersionId: output.result.technicalDesign.versionId,
      executionPlanVersionId: output.result.executionPlan.versionId,
    });
    expect(output.events.map(({ status }) => status)).toEqual([
      "collecting_idea",
      "analyzing_request",
      "generating_product_spec",
      "awaiting_product_spec_approval",
      "generating_technical_design",
      "awaiting_technical_design_approval",
      "generating_execution_plan",
      "awaiting_execution_plan_approval",
      "ready_for_development",
    ]);
    expect(output.markdown.projectSpec).toContain("REQ-1");
    expect(output.markdown.technicalDesign).toContain("DES-1");
    expect(output.markdown.executionPlan).toContain("task-workflow");
  });
});
