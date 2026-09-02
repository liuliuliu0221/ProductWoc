import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DevelopmentOutboxEvent } from "@product-woc/development-contracts";

import {
  DevelopmentCheckpointConflictError,
  DevelopmentCheckpointCorruptionError,
  FileDevelopmentCheckpointStore,
  InMemoryDevelopmentCheckpointStore,
  developmentStorageHash,
} from "../src/index.js";

const at = "2026-08-29T16:00:00.000Z";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function parseValue(value: unknown): { status: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    typeof value.status !== "string"
  ) {
    throw new Error("invalid fixture value");
  }
  return { status: value.status };
}

function event(sequence: number, id = `event-${sequence}`): DevelopmentOutboxEvent {
  const payload = { status: `state-${sequence}` };
  return {
    eventId: id,
    developmentRunId: "development-run-1",
    sequence,
    requestId: `request-${sequence}`,
    commandKind: "start",
    eventType: "development.state_changed",
    aggregateRevision: sequence,
    payload,
    payloadHash: developmentStorageHash(payload),
    occurredAt: at,
  };
}

describe("Development Checkpoint Store", () => {
  it("atomically commits state and Outbox with optimistic revisions", async () => {
    const store = new InMemoryDevelopmentCheckpointStore(parseValue);
    const first = await store.commit(
      "workspace:run",
      null,
      { status: "ready" },
      [event(1)],
      at,
    );
    expect(first.revision).toBe(1);
    await expect(
      store.commit("workspace:run", null, { status: "stale" }, [], at),
    ).rejects.toBeInstanceOf(DevelopmentCheckpointConflictError);
    expect(await store.pendingOutbox("workspace:run")).toEqual([event(1)]);

    const published = await store.markOutboxPublished(
      "workspace:run",
      first.revision,
      ["event-1"],
      "2026-08-29T16:00:01.000Z",
    );
    expect(published.revision).toBe(2);
    expect(await store.pendingOutbox("workspace:run")).toEqual([]);
  });

  it("restores a valid file Checkpoint and ignores an abandoned temp write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "product-woc-development-store-"));
    directories.push(directory);
    const key = "workspace:durable-run";
    const firstStore = new FileDevelopmentCheckpointStore(directory, parseValue);
    await firstStore.commit(key, null, { status: "paused" }, [event(1)], at);
    await writeFile(join(directory, "abandoned.tmp-partial"), "{", "utf8");

    const restartedStore = new FileDevelopmentCheckpointStore(directory, parseValue);
    await expect(restartedStore.load(key)).resolves.toEqual({
      revision: 1,
      value: { status: "paused" },
    });
    await expect(restartedStore.pendingOutbox(key)).resolves.toHaveLength(1);
  });

  it("rejects a tampered file before returning any state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "product-woc-development-corrupt-"));
    directories.push(directory);
    const key = "workspace:corrupt-run";
    const store = new FileDevelopmentCheckpointStore(directory, parseValue);
    await store.commit(key, null, { status: "ready" }, [event(1)], at);
    const target = join(directory, `${Buffer.from(key).toString("base64url")}.json`);
    const serialized = await readFile(target, "utf8");
    await writeFile(target, serialized.replace("ready", "owned"), "utf8");

    const restartedStore = new FileDevelopmentCheckpointStore(directory, parseValue);
    await expect(restartedStore.load(key)).rejects.toBeInstanceOf(
      DevelopmentCheckpointCorruptionError,
    );
  });

  it("rejects duplicate, out-of-order, or payload-tampered Outbox Events", async () => {
    const store = new InMemoryDevelopmentCheckpointStore(parseValue);
    await store.commit("run", null, { status: "ready" }, [event(1)], at);
    await expect(
      store.commit("run", 1, { status: "running" }, [event(3)], at),
    ).rejects.toBeInstanceOf(DevelopmentCheckpointCorruptionError);
    await expect(
      store.commit("run", 1, { status: "running" }, [event(2, "event-1")], at),
    ).rejects.toBeInstanceOf(DevelopmentCheckpointCorruptionError);
    await expect(
      store.commit(
        "run",
        1,
        { status: "running" },
        [{ ...event(2), payload: { status: "tampered" } }],
        at,
      ),
    ).rejects.toBeInstanceOf(DevelopmentCheckpointCorruptionError);
  });
});
