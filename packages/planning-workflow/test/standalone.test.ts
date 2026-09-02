import { describe, expect, it } from "vitest";

import {
  createInMemoryStandalonePlanningPorts,
  runAutoApprovedStandalonePlanning,
  StandalonePlanningError,
} from "../src/index.js";

const request = {
  workspaceId: "standalone-workspace",
  projectId: "standalone-project",
  requestedBy: "standalone-user",
  requestId: "standalone-request",
  idea: "Build a private customer feedback tracker",
} as const;

describe("standalone planning workflow", () => {
  it("persists all local versions and approvals without external services", async () => {
    const ports = createInMemoryStandalonePlanningPorts();
    const result = await runAutoApprovedStandalonePlanning(request, ports);

    expect(result.aggregate.snapshot.status).toBe("ready_for_development");
    await expect(
      ports.documents.find("project_spec", result.projectSpec.versionId),
    ).resolves.toEqual(result.projectSpec);
    await expect(
      ports.documents.find("technical_design", result.technicalDesign.versionId),
    ).resolves.toEqual(result.technicalDesign);
    await expect(
      ports.documents.find("execution_plan", result.executionPlan.versionId),
    ).resolves.toEqual(result.executionPlan);
    for (const approval of result.aggregate.approvalHistory) {
      await expect(
        ports.approvals.findByApprovalId(approval.approvalId),
      ).resolves.toEqual(approval);
    }
    expect(result.technicalDesign.dependencies).toEqual([]);
    expect(result.technicalDesign.platformCapabilities).toEqual([]);
  });

  it("does not silently overwrite an existing local project run", async () => {
    const ports = createInMemoryStandalonePlanningPorts();
    await runAutoApprovedStandalonePlanning(request, ports);

    await expect(
      runAutoApprovedStandalonePlanning(
        { ...request, requestId: "standalone-request-2" },
        ports,
      ),
    ).rejects.toBeInstanceOf(StandalonePlanningError);
  });
});
