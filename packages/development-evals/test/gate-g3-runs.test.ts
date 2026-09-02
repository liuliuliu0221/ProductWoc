import { describe, expect, it } from "vitest";

import {
  contentHash,
  createDevelopmentAggregate,
  startDevelopmentRun,
} from "@product-woc/development-domain";
import { buildDevelopmentInput } from "../../development-domain/test/fixtures.js";

describe("Gate G3 development starts", () => {
  it("starts five local runs from five distinct immutable Execution Plan versions", () => {
    const versionIds = new Set<string>();
    for (let index = 1; index <= 5; index += 1) {
      const versionId = `plan-g3-${index}`;
      const input = structuredClone(buildDevelopmentInput());
      input.creationRequestId = `create-g3-${index}`;
      input.developmentRunId = `development-g3-${index}`;
      input.executionPlan.versionId = versionId;
      input.envelope.envelopeId = `env:${contentHash([
        input.envelope.planningWorkflowRunId,
        input.envelope.projectSpecVersionId,
        input.envelope.technicalDesignVersionId,
        versionId,
      ]).slice(0, 48)}`;
      input.envelope.executionPlanVersionId = versionId;
      if (!input.authority.snapshot.executionPlan) {
        throw new Error("Execution Plan snapshot is required");
      }
      input.authority.snapshot.executionPlan.versionId = versionId;
      input.authority.effectiveApprovals = input.authority.effectiveApprovals.map(
        (approval) =>
          approval.subjectType === "execution_plan"
            ? { ...approval, subjectVersionId: versionId }
            : approval,
      );

      const creation = createDevelopmentAggregate(input);
      if (!creation.created) throw new Error(JSON.stringify(creation.issues));
      expect(creation.created).toBe(true);
      const started = startDevelopmentRun(creation.aggregate, {
        requestId: `start-g3-${index}`,
        startedAt: `2026-09-02T00:00:0${index}.000Z`,
      });
      expect(started.result).toMatchObject({ accepted: true, runStatus: "running" });
      expect(started.aggregate.run.status).toBe("running");
      versionIds.add(started.aggregate.input.executionPlanVersionId);
    }
    expect(versionIds.size).toBe(5);
  });
});
