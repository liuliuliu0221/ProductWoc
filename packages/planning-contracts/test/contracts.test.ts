import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  planningContractManifestSchema,
  planningWorkflowInputV2Schema,
} from "../src/index.js";
import {
  planningContractManifest,
  planningWorkflowDefinitionIdentity,
} from "../src/manifest.js";
import {
  adaptPlanningInputV1ToV2,
  PRODUCTFAC_PLANNING_V1_SOURCE_SCHEMA_HASH,
} from "../src/v1-compat.js";

describe("planning v2 contracts", () => {
  it("accepts a complete workflow input", () => {
    const result = planningWorkflowInputV2Schema.safeParse({
      workspaceId: "workspace-1",
      projectId: "project-1",
      requestedBy: "user-1",
      requestId: "request-1",
      idea: "Build an issue tracking application",
      workflowVersion: "2.0.0",
      approvalPolicyVersion: "2.0.0",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const result = planningWorkflowInputV2Schema.safeParse({
      workspaceId: "workspace-1",
      projectId: "project-1",
      requestedBy: "user-1",
      requestId: "request-1",
      idea: "Build an issue tracking application",
      workflowVersion: "2.0.0",
      approvalPolicyVersion: "2.0.0",
      actorIsAdmin: true,
    });

    expect(result.success).toBe(false);
  });

  it("keeps the checked-in manifest valid", () => {
    expect(planningContractManifestSchema.parse(planningContractManifest)).toEqual(
      planningContractManifest,
    );
    expect(planningContractManifest.sourceSchemaHash).toBe(
      PRODUCTFAC_PLANNING_V1_SOURCE_SCHEMA_HASH,
    );
    expect(planningContractManifest.definitionChecksum).toBe(
      createHash("sha256")
        .update(JSON.stringify(planningWorkflowDefinitionIdentity))
        .digest("hex"),
    );
  });

  it("adapts v1 input without overloading v1 fields", () => {
    expect(
      adaptPlanningInputV1ToV2(
        {
          projectId: "project-1",
          idea: "Build an issue tracking application",
          requestedBy: "user-1",
        },
        {
          workspaceId: "workspace-1",
          requestId: "request-1",
          workflowVersion: "2.0.0",
          approvalPolicyVersion: "2.0.0",
        },
      ),
    ).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      workflowVersion: "2.0.0",
    });
  });
});
