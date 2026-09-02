import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileTransactionalCheckpointStore,
  InMemoryTransactionalCheckpointStore,
  type PlanningEventPublisher,
} from "@product-woc/planning-adapters";

import {
  createInMemoryStandalonePlanningPorts,
  runDurableStandalonePlanning,
  type DurableStandalonePlanningCheckpoint,
  type StandalonePlanningPorts,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const request = {
  workspaceId: "durable-workspace",
  projectId: "durable-project",
  requestedBy: "durable-user",
  requestId: "durable-request",
  idea: "Build a durable private planning tracker",
} as const;

describe("durable standalone planning", () => {
  it("resumes a paused file checkpoint after recreating runtime adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "product-woc-durable-"));
    temporaryDirectories.push(directory);
    const firstStore =
      new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
        directory,
      );
    const paused = await runDurableStandalonePlanning(
      request,
      createInMemoryStandalonePlanningPorts(),
      firstStore,
      { pauseAfterStatus: "awaiting_technical_design_approval" },
    );

    expect(paused).toMatchObject({
      status: "paused",
      checkpoint: {
        aggregate: {
          snapshot: { status: "awaiting_technical_design_approval" },
        },
      },
    });

    const restartedStore =
      new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
        directory,
      );
    const completed = await runDurableStandalonePlanning(
      request,
      createInMemoryStandalonePlanningPorts(),
      restartedStore,
    );
    if (completed.status !== "completed") {
      throw new Error("Expected the restarted workflow to complete");
    }

    expect(completed.result.aggregate.snapshot.status).toBe("ready_for_development");
    expect(completed.result.aggregate.approvalHistory).toHaveLength(3);
    expect(await restartedStore.pendingOutbox("durable-workspace:durable-project")).toEqual(
      [],
    );

    const replayed = await runDurableStandalonePlanning(
      request,
      createInMemoryStandalonePlanningPorts(),
      restartedStore,
    );
    expect(replayed).toMatchObject({
      status: "completed",
      checkpointRevision: completed.checkpointRevision,
      result: {
        developmentStart: completed.result.developmentStart,
      },
    });
  });

  it("recovers a committed outbox event after publication fails", async () => {
    const store =
      new InMemoryTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>();
    const failedPublisher: PlanningEventPublisher = {
      publish: async () => {
        throw new Error("simulated publisher outage");
      },
    };
    const basePorts = createInMemoryStandalonePlanningPorts();
    const failingPorts: StandalonePlanningPorts = {
      ...basePorts,
      events: failedPublisher,
    };

    await expect(
      runDurableStandalonePlanning(request, failingPorts, store),
    ).rejects.toThrow("simulated publisher outage");
    expect(await store.pendingOutbox("durable-workspace:durable-project")).toHaveLength(
      1,
    );

    const recoveryPorts = createInMemoryStandalonePlanningPorts();
    const recovered = await runDurableStandalonePlanning(
      request,
      recoveryPorts,
      store,
    );
    expect(recovered.status).toBe("completed");
    expect(await store.pendingOutbox("durable-workspace:durable-project")).toEqual([]);
    expect(recoveryPorts.events.events[0]).toMatchObject({
      eventId: "event:workflow-run-1:0:collecting_idea",
      status: "collecting_idea",
    });
  });
});
