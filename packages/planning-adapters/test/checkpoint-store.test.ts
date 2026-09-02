import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CheckpointConflictError,
  FileTransactionalCheckpointStore,
  InMemoryTransactionalCheckpointStore,
  type LocalOutboxEvent,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function event(id: string): LocalOutboxEvent {
  return {
    eventId: id,
    type: "planning.status_changed",
    payload: { status: "analyzing_request" },
    occurredAt: "2026-08-28T00:00:00Z",
  };
}

describe("transactional checkpoint stores", () => {
  it("enforces optimistic revisions and tracks an in-memory outbox", async () => {
    const store = new InMemoryTransactionalCheckpointStore<{ status: string }>();
    const first = await store.commit("run-1", null, { status: "started" }, [
      event("event-1"),
    ]);

    expect(first.revision).toBe(1);
    await expect(
      store.commit("run-1", null, { status: "stale" }, []),
    ).rejects.toBeInstanceOf(CheckpointConflictError);
    expect(await store.pendingOutbox("run-1")).toHaveLength(1);
    await store.markOutboxPublished(
      "run-1",
      ["event-1"],
      "2026-08-28T00:00:01Z",
    );
    expect(await store.pendingOutbox("run-1")).toEqual([]);
  });

  it("atomically restores file checkpoints through a new store instance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "product-woc-checkpoint-"));
    temporaryDirectories.push(directory);
    const firstStore = new FileTransactionalCheckpointStore<{ status: string }>(
      directory,
    );
    await firstStore.commit("workspace:project", null, { status: "paused" }, [
      event("event-file-1"),
    ]);

    const restartedStore = new FileTransactionalCheckpointStore<{ status: string }>(
      directory,
    );
    await expect(restartedStore.load("workspace:project")).resolves.toEqual({
      revision: 1,
      value: { status: "paused" },
    });
    await expect(restartedStore.pendingOutbox("workspace:project")).resolves.toEqual([
      event("event-file-1"),
    ]);
    await restartedStore.markOutboxPublished(
      "workspace:project",
      ["event-file-1"],
      "2026-08-28T00:00:01Z",
    );
    await expect(restartedStore.pendingOutbox("workspace:project")).resolves.toEqual(
      [],
    );
  });
});
