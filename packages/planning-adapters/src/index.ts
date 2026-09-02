import type {
  ApprovalBindingV2,
  ExecutionPlanVersion,
  PlanningSnapshotV2,
  PlanningSubject,
  ProjectSpecVersion,
  TechnicalDesignVersion,
} from "@product-woc/planning-contracts";

export * from "./checkpoint-store.js";

export type PlanningDocumentVersion =
  | ProjectSpecVersion
  | TechnicalDesignVersion
  | ExecutionPlanVersion;

export interface PlanningRunRepository {
  getSnapshot(workspaceId: string, projectId: string): Promise<PlanningSnapshotV2 | null>;
  saveSnapshot(snapshot: PlanningSnapshotV2): Promise<void>;
}

export interface ApprovalRepository {
  findByApprovalId(approvalId: string): Promise<ApprovalBindingV2 | null>;
  append(approval: ApprovalBindingV2): Promise<void>;
}

export interface PlanningDocumentRepository {
  find(
    subject: PlanningSubject,
    versionId: string,
  ): Promise<PlanningDocumentVersion | null>;
  save(subject: PlanningSubject, version: PlanningDocumentVersion): Promise<void>;
}

export interface PlanningEventPublisher {
  publish(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  nextId(scope: string): string;
}

function aggregateKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export class InMemoryPlanningRunRepository implements PlanningRunRepository {
  private readonly snapshots = new Map<string, PlanningSnapshotV2>();

  public async getSnapshot(
    workspaceId: string,
    projectId: string,
  ): Promise<PlanningSnapshotV2 | null> {
    return this.snapshots.get(aggregateKey(workspaceId, projectId)) ?? null;
  }

  public async saveSnapshot(snapshot: PlanningSnapshotV2): Promise<void> {
    this.snapshots.set(
      aggregateKey(snapshot.workspaceId, snapshot.projectId),
      structuredClone(snapshot),
    );
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly approvals = new Map<string, ApprovalBindingV2>();

  public async findByApprovalId(approvalId: string): Promise<ApprovalBindingV2 | null> {
    return this.approvals.get(approvalId) ?? null;
  }

  public async append(approval: ApprovalBindingV2): Promise<void> {
    this.approvals.set(approval.approvalId, structuredClone(approval));
  }
}

export class InMemoryPlanningDocumentRepository
  implements PlanningDocumentRepository
{
  private readonly versions = new Map<string, PlanningDocumentVersion>();

  public async find(
    subject: PlanningSubject,
    versionId: string,
  ): Promise<PlanningDocumentVersion | null> {
    return this.versions.get(`${subject}:${versionId}`) ?? null;
  }

  public async save(
    subject: PlanningSubject,
    version: PlanningDocumentVersion,
  ): Promise<void> {
    this.versions.set(`${subject}:${version.versionId}`, structuredClone(version));
  }
}

export class CollectingPlanningEventPublisher implements PlanningEventPublisher {
  public readonly events: Readonly<Record<string, unknown>>[] = [];

  public async publish(event: Readonly<Record<string, unknown>>): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

export class SystemClock implements Clock {
  public now(): string {
    return new Date().toISOString();
  }
}

export class SequenceClock implements Clock {
  private offset = 0;

  public constructor(private readonly epochMs = Date.UTC(2026, 0, 1)) {}

  public now(): string {
    const value = new Date(this.epochMs + this.offset).toISOString();
    this.offset += 1;
    return value;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private nextValue = 1;

  public nextId(scope: string): string {
    const id = `${scope}-${this.nextValue}`;
    this.nextValue += 1;
    return id;
  }
}
