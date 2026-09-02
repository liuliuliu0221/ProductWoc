import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LocalOutboxEvent {
  eventId: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
  publishedAt?: string;
}

export interface VersionedCheckpoint<T> {
  revision: number;
  value: T;
}

export interface TransactionalCheckpointStore<T> {
  load(key: string): Promise<VersionedCheckpoint<T> | null>;
  commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly LocalOutboxEvent[],
  ): Promise<VersionedCheckpoint<T>>;
  pendingOutbox(key: string): Promise<readonly LocalOutboxEvent[]>;
  markOutboxPublished(
    key: string,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<void>;
}

interface StoredCheckpoint<T> extends VersionedCheckpoint<T> {
  outbox: readonly LocalOutboxEvent[];
}

export class CheckpointConflictError extends Error {
  public constructor(
    public readonly expectedRevision: number | null,
    public readonly actualRevision: number | null,
  ) {
    super(
      `Checkpoint revision conflict: expected ${expectedRevision ?? "new"}, actual ${actualRevision ?? "missing"}`,
    );
    this.name = "CheckpointConflictError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTransactionalCheckpointStore<T>
  implements TransactionalCheckpointStore<T>
{
  private readonly checkpoints = new Map<string, StoredCheckpoint<T>>();

  public async load(key: string): Promise<VersionedCheckpoint<T> | null> {
    const checkpoint = this.checkpoints.get(key);
    return checkpoint
      ? { revision: checkpoint.revision, value: clone(checkpoint.value) }
      : null;
  }

  public async commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly LocalOutboxEvent[],
  ): Promise<VersionedCheckpoint<T>> {
    const current = this.checkpoints.get(key);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new CheckpointConflictError(expectedRevision, actualRevision);
    }
    const checkpoint: StoredCheckpoint<T> = {
      revision: (actualRevision ?? 0) + 1,
      value: clone(value),
      outbox: [...(current?.outbox ?? []), ...clone(events)],
    };
    this.checkpoints.set(key, checkpoint);
    return { revision: checkpoint.revision, value: clone(checkpoint.value) };
  }

  public async pendingOutbox(key: string): Promise<readonly LocalOutboxEvent[]> {
    return clone(
      (this.checkpoints.get(key)?.outbox ?? []).filter(
        ({ publishedAt }) => publishedAt === undefined,
      ),
    );
  }

  public async markOutboxPublished(
    key: string,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<void> {
    const current = this.checkpoints.get(key);
    if (!current) {
      return;
    }
    const selected = new Set(eventIds);
    this.checkpoints.set(key, {
      ...current,
      outbox: current.outbox.map((event) =>
        selected.has(event.eventId) ? { ...event, publishedAt } : event,
      ),
    });
  }
}

export class FileTransactionalCheckpointStore<T>
  implements TransactionalCheckpointStore<T>
{
  private temporarySequence = 0;

  public constructor(private readonly directory: string) {}

  private pathFor(key: string): string {
    return join(this.directory, `${Buffer.from(key).toString("base64url")}.json`);
  }

  private async loadStored(key: string): Promise<StoredCheckpoint<T> | null> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), "utf8")) as StoredCheckpoint<T>;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async writeStored(key: string, value: StoredCheckpoint<T>): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.pathFor(key);
    this.temporarySequence += 1;
    const temporary = `${target}.tmp-${process.pid}-${this.temporarySequence}`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
  }

  public async load(key: string): Promise<VersionedCheckpoint<T> | null> {
    const checkpoint = await this.loadStored(key);
    return checkpoint
      ? { revision: checkpoint.revision, value: clone(checkpoint.value) }
      : null;
  }

  public async commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly LocalOutboxEvent[],
  ): Promise<VersionedCheckpoint<T>> {
    const current = await this.loadStored(key);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new CheckpointConflictError(expectedRevision, actualRevision);
    }
    const checkpoint: StoredCheckpoint<T> = {
      revision: (actualRevision ?? 0) + 1,
      value: clone(value),
      outbox: [...(current?.outbox ?? []), ...clone(events)],
    };
    await this.writeStored(key, checkpoint);
    return { revision: checkpoint.revision, value: clone(checkpoint.value) };
  }

  public async pendingOutbox(key: string): Promise<readonly LocalOutboxEvent[]> {
    return clone(
      ((await this.loadStored(key))?.outbox ?? []).filter(
        ({ publishedAt }) => publishedAt === undefined,
      ),
    );
  }

  public async markOutboxPublished(
    key: string,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<void> {
    const current = await this.loadStored(key);
    if (!current) {
      return;
    }
    const selected = new Set(eventIds);
    await this.writeStored(key, {
      ...current,
      outbox: current.outbox.map((event) =>
        selected.has(event.eventId) ? { ...event, publishedAt } : event,
      ),
    });
  }
}
