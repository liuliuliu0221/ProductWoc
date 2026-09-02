import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import {
  createInMemoryStandalonePlanningPorts,
  runDurableStandalonePlanning,
  type DurableStandalonePlanningCheckpoint,
} from "@product-woc/planning-workflow";
import { describe, expect, it } from "vitest";

import { bootstrapAndStartDevelopmentFromPlanning } from "../src/bootstrap.js";

describe("Development bootstrap", () => {
  it("starts once from the authoritative local Planning Envelope and then resumes", async () => {
    const root = await mkdtemp(join(tmpdir(), "product-woc-p3h-bootstrap-"));
    const planningDataDirectory = join(root, "planning");
    const developmentDataDirectory = join(root, "development");
    const planningStore = new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
      planningDataDirectory,
    );
    const planning = await runDurableStandalonePlanning(
      {
        workspaceId: "local-workspace",
        projectId: "p3h-bootstrap",
        requestedBy: "local-user",
        requestId: "p3h-planning",
        idea: "Create a local checkpoint inspector with a deterministic workflow.",
      },
      createInMemoryStandalonePlanningPorts(),
      planningStore,
    );
    expect(planning.status).toBe("completed");

    const input = {
      workspaceId: "local-workspace",
      projectId: "p3h-bootstrap",
      actorId: "local-user",
      workspaceRoot: root,
      planningDataDirectory,
      developmentDataDirectory,
      requestId: "p3h-development",
      occurredAt: "2026-09-02T00:00:00.000Z",
    };
    const started = await bootstrapAndStartDevelopmentFromPlanning(input);
    expect(started.resumed).toBe(false);
    expect(started.checkpoint.aggregate.run.status).toBe("running");
    expect(started.checkpoint.aggregate.run.currentTaskRunId).toBeTruthy();

    const resumed = await bootstrapAndStartDevelopmentFromPlanning(input);
    expect(resumed.resumed).toBe(true);
    expect(resumed.checkpointRevision).toBe(started.checkpointRevision);
    expect(resumed.checkpoint.developmentRunId).toBe(started.checkpoint.developmentRunId);
  });
});
