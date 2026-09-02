import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  developmentOutboxEventSchema,
  type DevelopmentOutboxEvent,
} from "@product-woc/development-contracts";

export interface VersionedDevelopmentCheckpoint<T> {
  revision: number;
  value: T;
}

export interface DevelopmentCheckpointStore<T> {
  load(key: string): Promise<VersionedDevelopmentCheckpoint<T> | null>;
  commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly DevelopmentOutboxEvent[],
    writtenAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>>;
  pendingOutbox(key: string): Promise<readonly DevelopmentOutboxEvent[]>;
  markOutboxPublished(
    key: string,
    expectedRevision: number,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>>;
}

interface StoredDevelopmentCheckpoint<T> {
  storageSchemaVersion: "1.0.0";
  key: string;
  revision: number;
  value: T;
  outbox: readonly DevelopmentOutboxEvent[];
  writtenAt: string;
  integrityHash: string;
}

export class DevelopmentCheckpointConflictError extends Error {
  public constructor(
    public readonly expectedRevision: number | null,
    public readonly actualRevision: number | null,
  ) {
    super(
      `Development Checkpoint revision conflict: expected ${expectedRevision ?? "new"}, actual ${actualRevision ?? "missing"}`,
    );
    this.name = "DevelopmentCheckpointConflictError";
  }
}
export class DevelopmentCheckpointCorruptionError extends Error {
  public constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DevelopmentCheckpointCorruptionError";
  }
}

export class DevelopmentCheckpointBusyError extends Error {
  public constructor(key: string) {
    super(`Development Checkpoint is locked by another writer: ${key}`);
    this.name = "DevelopmentCheckpointBusyError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  throw new DevelopmentCheckpointCorruptionError(
    "Development Checkpoint contains a non-JSON value",
  );
}

export function developmentStorageHash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function recordHash<T>(record: Omit<StoredDevelopmentCheckpoint<T>, "integrityHash">): string {
  return developmentStorageHash(record);
}

function validatedEvents(
  events: readonly DevelopmentOutboxEvent[],
): readonly DevelopmentOutboxEvent[] {
  return events.map((event) => {
    const parsed = developmentOutboxEventSchema.parse(event);
    if (parsed.payloadHash !== developmentStorageHash(parsed.payload)) {
      throw new DevelopmentCheckpointCorruptionError(
        `Outbox payload Hash mismatch for ${parsed.eventId}`,
      );
    }
    return parsed;
  });
}

function validateNewEvents(
  existing: readonly DevelopmentOutboxEvent[],
  events: readonly DevelopmentOutboxEvent[],
): readonly DevelopmentOutboxEvent[] {
  const parsed = validatedEvents(events);
  const ids = new Set(existing.map(({ eventId }) => eventId));
  let sequence = existing.at(-1)?.sequence ?? 0;
  for (const event of parsed) {
    if (ids.has(event.eventId)) {
      throw new DevelopmentCheckpointCorruptionError(
        `Duplicate Outbox Event ID: ${event.eventId}`,
      );
    }
    if (event.sequence !== sequence + 1) {
      throw new DevelopmentCheckpointCorruptionError(
        `Outbox Event sequence must be contiguous after ${sequence}`,
      );
    }
    ids.add(event.eventId);
    sequence = event.sequence;
  }
  return parsed;
}

function createStored<T>(input: {
  key: string;
  revision: number;
  value: T;
  outbox: readonly DevelopmentOutboxEvent[];
  writtenAt: string;
}): StoredDevelopmentCheckpoint<T> {
  const body = {
    storageSchemaVersion: "1.0.0" as const,
    key: input.key,
    revision: input.revision,
    value: clone(input.value),
    outbox: clone(input.outbox),
    writtenAt: input.writtenAt,
  };
  return { ...body, integrityHash: recordHash(body) };
}

function parseStored<T>(
  raw: unknown,
  expectedKey: string,
  parseValue: (value: unknown) => T,
): StoredDevelopmentCheckpoint<T> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DevelopmentCheckpointCorruptionError("Checkpoint root is invalid");
  }
  const record = raw as Record<string, unknown>;
  if (
    record.storageSchemaVersion !== "1.0.0" ||
    record.key !== expectedKey ||
    !Number.isInteger(record.revision) ||
    (record.revision as number) <= 0 ||
    typeof record.writtenAt !== "string" ||
    typeof record.integrityHash !== "string" ||
    !Array.isArray(record.outbox)
  ) {
    throw new DevelopmentCheckpointCorruptionError(
      "Checkpoint storage envelope is invalid",
    );
  }
  const value = parseValue(record.value);
  const outbox = validatedEvents(record.outbox as DevelopmentOutboxEvent[]);
  const body = {
    storageSchemaVersion: "1.0.0" as const,
    key: expectedKey,
    revision: record.revision as number,
    value,
    outbox,
    writtenAt: record.writtenAt,
  };
  if (record.integrityHash !== recordHash(body)) {
    throw new DevelopmentCheckpointCorruptionError(
      "Checkpoint integrity Hash mismatch",
    );
  }
  return { ...body, integrityHash: record.integrityHash };
}

export class InMemoryDevelopmentCheckpointStore<T>
  implements DevelopmentCheckpointStore<T>
{
  private readonly records = new Map<string, StoredDevelopmentCheckpoint<T>>();

  public constructor(private readonly parseValue: (value: unknown) => T) {}

  public async load(key: string): Promise<VersionedDevelopmentCheckpoint<T> | null> {
    const record = this.records.get(key);
    if (!record) return null;
    const parsed = parseStored(clone(record), key, this.parseValue);
    return { revision: parsed.revision, value: clone(parsed.value) };
  }

  public async commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly DevelopmentOutboxEvent[],
    writtenAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>> {
    const current = this.records.get(key);
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new DevelopmentCheckpointConflictError(expectedRevision, actualRevision);
    }
    const parsedValue = this.parseValue(value);
    const outbox = [
      ...(current?.outbox ?? []),
      ...validateNewEvents(current?.outbox ?? [], events),
    ];
    const record = createStored({
      key,
      revision: (actualRevision ?? 0) + 1,
      value: parsedValue,
      outbox,
      writtenAt,
    });
    this.records.set(key, record);
    return { revision: record.revision, value: clone(record.value) };
  }

  public async pendingOutbox(key: string): Promise<readonly DevelopmentOutboxEvent[]> {
    return clone(
      (this.records.get(key)?.outbox ?? []).filter(({ publishedAt }) => !publishedAt),
    );
  }

  public async markOutboxPublished(
    key: string,
    expectedRevision: number,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>> {
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) {
      throw new DevelopmentCheckpointConflictError(
        expectedRevision,
        current?.revision ?? null,
      );
    }
    const selected = new Set(eventIds);
    const outbox = current.outbox.map((event) =>
      selected.has(event.eventId) && !event.publishedAt
        ? { ...event, publishedAt }
        : event,
    );
    const record = createStored({
      key,
      revision: current.revision + 1,
      value: current.value,
      outbox,
      writtenAt: publishedAt,
    });
    this.records.set(key, record);
    return { revision: record.revision, value: clone(record.value) };
  }
}

export class FileDevelopmentCheckpointStore<T>
  implements DevelopmentCheckpointStore<T>
{
  private temporarySequence = 0;

  public constructor(
    private readonly directory: string,
    private readonly parseValue: (value: unknown) => T,
  ) {}

  private pathFor(key: string): string {
    return join(this.directory, `${Buffer.from(key).toString("base64url")}.json`);
  }

  private lockPathFor(key: string): string {
    return `${this.pathFor(key)}.lock`;
  }

  private async loadStored(key: string): Promise<StoredDevelopmentCheckpoint<T> | null> {
    try {
      const raw = JSON.parse(await readFile(this.pathFor(key), "utf8")) as unknown;
      return parseStored(raw, key, this.parseValue);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      if (error instanceof DevelopmentCheckpointCorruptionError) throw error;
      throw new DevelopmentCheckpointCorruptionError(
        `Cannot read Development Checkpoint ${key}`,
        error,
      );
    }
  }

  private async withWriterLock<R>(key: string, operation: () => Promise<R>): Promise<R> {
    await mkdir(this.directory, { recursive: true });
    const lockPath = this.lockPathFor(key);
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new DevelopmentCheckpointBusyError(key);
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  private async writeStored(key: string, record: StoredDevelopmentCheckpoint<T>): Promise<void> {
    const target = this.pathFor(key);
    this.temporarySequence += 1;
    const temporary = `${target}.tmp-${process.pid}-${this.temporarySequence}`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  public async load(key: string): Promise<VersionedDevelopmentCheckpoint<T> | null> {
    const record = await this.loadStored(key);
    return record ? { revision: record.revision, value: clone(record.value) } : null;
  }

  public async commit(
    key: string,
    expectedRevision: number | null,
    value: T,
    events: readonly DevelopmentOutboxEvent[],
    writtenAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>> {
    return this.withWriterLock(key, async () => {
      const current = await this.loadStored(key);
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new DevelopmentCheckpointConflictError(expectedRevision, actualRevision);
      }
      const parsedValue = this.parseValue(value);
      const record = createStored({
        key,
        revision: (actualRevision ?? 0) + 1,
        value: parsedValue,
        outbox: [
          ...(current?.outbox ?? []),
          ...validateNewEvents(current?.outbox ?? [], events),
        ],
        writtenAt,
      });
      await this.writeStored(key, record);
      return { revision: record.revision, value: clone(record.value) };
    });
  }

  public async pendingOutbox(key: string): Promise<readonly DevelopmentOutboxEvent[]> {
    return clone(
      ((await this.loadStored(key))?.outbox ?? []).filter(
        ({ publishedAt }) => !publishedAt,
      ),
    );
  }

  public async markOutboxPublished(
    key: string,
    expectedRevision: number,
    eventIds: readonly string[],
    publishedAt: string,
  ): Promise<VersionedDevelopmentCheckpoint<T>> {
    return this.withWriterLock(key, async () => {
      const current = await this.loadStored(key);
      if (!current || current.revision !== expectedRevision) {
        throw new DevelopmentCheckpointConflictError(
          expectedRevision,
          current?.revision ?? null,
        );
      }
      const selected = new Set(eventIds);
      const record = createStored({
        key,
        revision: current.revision + 1,
        value: current.value,
        outbox: current.outbox.map((event) =>
          selected.has(event.eventId) && !event.publishedAt
            ? { ...event, publishedAt }
            : event,
        ),
        writtenAt: publishedAt,
      });
      await this.writeStored(key, record);
      return { revision: record.revision, value: clone(record.value) };
    });
  }
}
