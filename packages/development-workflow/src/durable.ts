import {
  agentRunSchema,
  developmentCommandReceiptSchema,
  developmentCommandResultSchema,
  developmentControlCommandSchema,
  developmentInputSnapshotSchema,
  developmentInvalidationRecordSchema,
  developmentPendingOperationSchema,
  developmentRecoveryAuditSchema,
  developmentRunSchema,
  developmentSafeBoundarySchema,
  developmentTransitionRecordSchema,
  evidenceManifestSchema,
  modelRunSnapshotSchema,
  patchJournalEntrySchema,
  phaseGateDecisionSchema,
  phaseRunSchema,
  repairAttemptSchema,
  structuredCommandResultSchema,
  taskContextSnapshotSchema,
  taskRunSchema,
  verificationEvidenceSchema,
  verificationLogArtifactSchema,
  type DevelopmentCommandKind,
  type DevelopmentCommandReceipt,
  type DevelopmentControlCommand,
  type DevelopmentOutboxEvent,
  type DevelopmentPendingOperation,
  type DevelopmentRecoveryAudit,
  type DevelopmentSafeBoundary,
  type EvidenceManifest,
  type ModelRunSnapshot,
  type PatchJournalEntry,
  type StructuredCommandResult,
  type TaskContextSnapshot,
  type VerificationLogArtifact,
} from "@product-woc/development-contracts";
import {
  developmentStorageHash,
  type DevelopmentCheckpointStore,
  type VersionedDevelopmentCheckpoint,
} from "@product-woc/development-adapters";
import {
  contentHash,
  controlDevelopmentRun,
  transitionTask,
  validateDevelopmentGraph,
  type DevelopmentAggregate,
  type DevelopmentExecutionGraph,
} from "@product-woc/development-domain";
import {
  developmentStartEnvelopeSchema,
  executionPlanVersionSchema,
  type DevelopmentStartEnvelope,
} from "@product-woc/planning-contracts";

export const DEVELOPMENT_CHECKPOINT_SCHEMA_VERSION = "1.0.0";

export interface DurableDevelopmentCheckpoint {
  schemaVersion: typeof DEVELOPMENT_CHECKPOINT_SCHEMA_VERSION;
  developmentRunId: string;
  aggregate: DevelopmentAggregate;
  safeBoundary: DevelopmentSafeBoundary;
  workspaceHash: string;
  modelSnapshots: readonly ModelRunSnapshot[];
  contextSnapshots: readonly TaskContextSnapshot[];
  patchJournal: readonly PatchJournalEntry[];
  evidenceManifests: readonly EvidenceManifest[];
  verificationArtifacts: readonly VerificationLogArtifact[];
  commandResults: readonly StructuredCommandResult[];
  commandReceipts: Readonly<Record<string, DevelopmentCommandReceipt>>;
  recoveryAudits: readonly DevelopmentRecoveryAudit[];
  pendingOperation?: DevelopmentPendingOperation;
  lastEventSequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface DevelopmentArtifactAppend {
  modelSnapshots?: readonly ModelRunSnapshot[];
  contextSnapshots?: readonly TaskContextSnapshot[];
  patchJournal?: readonly PatchJournalEntry[];
  evidenceManifests?: readonly EvidenceManifest[];
  verificationArtifacts?: readonly VerificationLogArtifact[];
  commandResults?: readonly StructuredCommandResult[];
}

export interface DevelopmentCheckpointMutation {
  aggregate: DevelopmentAggregate;
  safeBoundary: DevelopmentSafeBoundary;
  workspaceHash?: string;
  artifacts?: DevelopmentArtifactAppend;
  result: unknown;
  accepted: boolean;
}

export interface ExecuteDevelopmentCheckpointCommandInput {
  key: string;
  expectedRevision: number;
  requestId: string;
  commandKind: DevelopmentCommandKind;
  occurredAt: string;
  mutate: (
    checkpoint: DurableDevelopmentCheckpoint,
  ) => DevelopmentCheckpointMutation;
}

export interface DevelopmentCheckpointCommandOutcome {
  checkpointRevision: number;
  checkpoint: DurableDevelopmentCheckpoint;
  result: unknown;
  replayed: boolean;
}

export interface DevelopmentOutboxPublisher {
  publish(event: DevelopmentOutboxEvent): Promise<void>;
}

export type DevelopmentRecoveryOutcome = {
  checkpointRevision: number;
  checkpoint: DurableDevelopmentCheckpoint;
  audit: DevelopmentRecoveryAudit;
  replayed: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`Unexpected Checkpoint fields: ${actual.join(",")}`);
  }
}

function parseEntityMap<T extends object>(
  value: unknown,
  idField: keyof T,
  parse: (item: unknown) => T,
): Readonly<Record<string, T>> {
  if (!isRecord(value)) throw new Error("Checkpoint entity map is invalid");
  const result: Record<string, T> = {};
  for (const [key, raw] of Object.entries(value)) {
    const item = parse(raw);
    if (item[idField] !== key) throw new Error(`Checkpoint entity key mismatch: ${key}`);
    result[key] = item;
  }
  return result;
}

function parseAggregate(value: unknown): DevelopmentAggregate {
  if (!isRecord(value)) throw new Error("Development aggregate is invalid");
  exactKeys(value, [
    "run",
    "input",
    "executionPlan",
    "graph",
    "phaseRuns",
    "taskRuns",
    "agentRuns",
    "repairHistory",
    "evidenceHistory",
    "gateHistory",
    "invalidationHistory",
    "transitionHistory",
    "processedCommands",
  ]);
  const run = developmentRunSchema.parse(value.run);
  const input = developmentInputSnapshotSchema.parse(value.input);
  const executionPlan = executionPlanVersionSchema.parse(value.executionPlan);
  const graphResult = validateDevelopmentGraph(executionPlan);
  if (!graphResult.valid) throw new Error("Persisted Execution Plan graph is invalid");
  if (contentHash(value.graph) !== contentHash(graphResult.graph)) {
    throw new Error("Persisted Development graph differs from the Execution Plan");
  }
  const phaseRuns = parseEntityMap(value.phaseRuns, "phaseRunId", (item) =>
    phaseRunSchema.parse(item),
  );
  const taskRuns = parseEntityMap(value.taskRuns, "taskRunId", (item) =>
    taskRunSchema.parse(item),
  );
  const agentRuns = parseEntityMap(value.agentRuns, "agentRunId", (item) =>
    agentRunSchema.parse(item),
  );
  if (!Array.isArray(value.repairHistory) || !Array.isArray(value.evidenceHistory)) {
    throw new Error("Checkpoint repair or Evidence history is invalid");
  }
  if (
    !Array.isArray(value.gateHistory) ||
    !Array.isArray(value.invalidationHistory) ||
    !Array.isArray(value.transitionHistory) ||
    !isRecord(value.processedCommands)
  ) {
    throw new Error("Checkpoint aggregate history is invalid");
  }
  const processedCommands: Record<string, ReturnType<typeof developmentCommandResultSchema.parse>> = {};
  for (const [requestId, raw] of Object.entries(value.processedCommands)) {
    const result = developmentCommandResultSchema.parse(raw);
    if (result.requestId !== requestId) throw new Error("Processed command key mismatch");
    processedCommands[requestId] = result;
  }
  if (
    run.developmentRunId !== input.developmentRunId ||
    run.input.envelopeHash !== input.envelopeHash ||
    input.taskGraphHash !== graphResult.graph.graphHash
  ) {
    throw new Error("Development aggregate identity binding is invalid");
  }
  const aggregate: DevelopmentAggregate = {
    run,
    input,
    executionPlan,
    graph: graphResult.graph as DevelopmentExecutionGraph,
    phaseRuns,
    taskRuns,
    agentRuns,
    repairHistory: value.repairHistory.map((item) => repairAttemptSchema.parse(item)),
    evidenceHistory: value.evidenceHistory.map((item) => verificationEvidenceSchema.parse(item)),
    gateHistory: value.gateHistory.map((item) => phaseGateDecisionSchema.parse(item)),
    invalidationHistory: value.invalidationHistory.map((item) =>
      developmentInvalidationRecordSchema.parse(item),
    ),
    transitionHistory: value.transitionHistory.map((item) =>
      developmentTransitionRecordSchema.parse(item),
    ),
    processedCommands,
  };
  for (const task of Object.values(taskRuns)) {
    if (task.developmentRunId !== run.developmentRunId) {
      throw new Error("Task Run belongs to a different Development Run");
    }
  }
  return aggregate;
}

function parseUniqueArray<T>(
  value: unknown,
  id: (item: T) => string,
  parse: (item: unknown) => T,
): readonly T[] {
  if (!Array.isArray(value)) throw new Error("Checkpoint artifact list is invalid");
  const parsed = value.map(parse);
  if (new Set(parsed.map(id)).size !== parsed.length) {
    throw new Error("Checkpoint artifact IDs must be unique");
  }
  return parsed;
}

export function parseDurableDevelopmentCheckpoint(
  value: unknown,
): DurableDevelopmentCheckpoint {
  if (!isRecord(value)) throw new Error("Development Checkpoint is invalid");
  const requiredKeys = [
    "schemaVersion",
    "developmentRunId",
    "aggregate",
    "safeBoundary",
    "workspaceHash",
    "modelSnapshots",
    "contextSnapshots",
    "patchJournal",
    "evidenceManifests",
    "verificationArtifacts",
    "commandResults",
    "commandReceipts",
    "recoveryAudits",
    "lastEventSequence",
    "createdAt",
    "updatedAt",
  ];
  exactKeys(value, Object.prototype.hasOwnProperty.call(value, "pendingOperation")
    ? [...requiredKeys, "pendingOperation"]
    : requiredKeys);
  if (value.schemaVersion !== DEVELOPMENT_CHECKPOINT_SCHEMA_VERSION) {
    throw new Error("Unsupported Development Checkpoint Schema");
  }
  const aggregate = parseAggregate(value.aggregate);
  const safeBoundary = developmentSafeBoundarySchema.parse(value.safeBoundary);
  if (
    typeof value.developmentRunId !== "string" ||
    value.developmentRunId !== aggregate.run.developmentRunId ||
    typeof value.workspaceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.workspaceHash) ||
    !Number.isInteger(value.lastEventSequence) ||
    (value.lastEventSequence as number) < 0 ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.commandReceipts) ||
    !Array.isArray(value.recoveryAudits)
  ) {
    throw new Error("Development Checkpoint identity or metadata is invalid");
  }
  const commandReceipts: Record<string, DevelopmentCommandReceipt> = {};
  for (const [requestId, raw] of Object.entries(value.commandReceipts)) {
    const receipt = developmentCommandReceiptSchema.parse(raw);
    if (receipt.requestId !== requestId) throw new Error("Command receipt key mismatch");
    commandReceipts[requestId] = receipt;
  }
  const checkpoint: DurableDevelopmentCheckpoint = {
    schemaVersion: DEVELOPMENT_CHECKPOINT_SCHEMA_VERSION,
    developmentRunId: value.developmentRunId,
    aggregate,
    safeBoundary,
    workspaceHash: value.workspaceHash,
    modelSnapshots: parseUniqueArray(value.modelSnapshots, (item: ModelRunSnapshot) => item.snapshotId, (item) => modelRunSnapshotSchema.parse(item)),
    contextSnapshots: parseUniqueArray(value.contextSnapshots, (item: TaskContextSnapshot) => item.contextSnapshotId, (item) => taskContextSnapshotSchema.parse(item)),
    patchJournal: parseUniqueArray(value.patchJournal, (item: PatchJournalEntry) => item.journalEntryId, (item) => patchJournalEntrySchema.parse(item)),
    evidenceManifests: parseUniqueArray(value.evidenceManifests, (item: EvidenceManifest) => item.manifestId, (item) => evidenceManifestSchema.parse(item)),
    verificationArtifacts: parseUniqueArray(value.verificationArtifacts, (item: VerificationLogArtifact) => item.artifactId, (item) => verificationLogArtifactSchema.parse(item)),
    commandResults: parseUniqueArray(value.commandResults, (item: StructuredCommandResult) => item.event.requestId, (item) => structuredCommandResultSchema.parse(item)),
    commandReceipts,
    recoveryAudits: value.recoveryAudits.map((item) => developmentRecoveryAuditSchema.parse(item)),
    ...(value.pendingOperation === undefined
      ? {}
      : { pendingOperation: developmentPendingOperationSchema.parse(value.pendingOperation) }),
    lastEventSequence: value.lastEventSequence as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  const runId = checkpoint.developmentRunId;
  const wrongArtifact = [
    ...checkpoint.modelSnapshots,
    ...checkpoint.contextSnapshots,
    ...checkpoint.patchJournal,
    ...checkpoint.evidenceManifests,
    ...checkpoint.verificationArtifacts,
  ].find((item) => "developmentRunId" in item && item.developmentRunId !== runId);
  if (wrongArtifact) throw new Error("Checkpoint Artifact belongs to another Run");
  return checkpoint;
}

function appendUnique<T>(
  current: readonly T[],
  additions: readonly T[] | undefined,
  id: (item: T) => string,
): readonly T[] {
  const result = [...current];
  const byId = new Map(result.map((item) => [id(item), item]));
  for (const item of additions ?? []) {
    const existing = byId.get(id(item));
    if (existing && contentHash(existing) !== contentHash(item)) {
      throw new Error(`Artifact ID ${id(item)} already has different content`);
    }
    if (!existing) {
      result.push(item);
      byId.set(id(item), item);
    }
  }
  return result;
}

function appendArtifacts(
  checkpoint: DurableDevelopmentCheckpoint,
  artifacts: DevelopmentArtifactAppend | undefined,
): Pick<
  DurableDevelopmentCheckpoint,
  "modelSnapshots" | "contextSnapshots" | "patchJournal" |
  "evidenceManifests" | "verificationArtifacts" | "commandResults"
> {
  return {
    modelSnapshots: appendUnique(checkpoint.modelSnapshots, artifacts?.modelSnapshots, (item) => item.snapshotId),
    contextSnapshots: appendUnique(checkpoint.contextSnapshots, artifacts?.contextSnapshots, (item) => item.contextSnapshotId),
    patchJournal: appendUnique(checkpoint.patchJournal, artifacts?.patchJournal, (item) => item.journalEntryId),
    evidenceManifests: appendUnique(checkpoint.evidenceManifests, artifacts?.evidenceManifests, (item) => item.manifestId),
    verificationArtifacts: appendUnique(checkpoint.verificationArtifacts, artifacts?.verificationArtifacts, (item) => item.artifactId),
    commandResults: appendUnique(checkpoint.commandResults, artifacts?.commandResults, (item) => item.event.requestId),
  };
}

function makeEvent(
  checkpoint: DurableDevelopmentCheckpoint,
  requestId: string,
  commandKind: DevelopmentCommandKind,
  occurredAt: string,
  eventType: DevelopmentOutboxEvent["eventType"] = "development.state_changed",
): DevelopmentOutboxEvent {
  const payload = {
    safeBoundary: checkpoint.safeBoundary,
    runStatus: checkpoint.aggregate.run.status,
    workspaceHash: checkpoint.workspaceHash,
  };
  const sequence = checkpoint.lastEventSequence;
  return {
    eventId: `development-event:${contentHash([
      checkpoint.developmentRunId,
      sequence,
      requestId,
      commandKind,
    ]).slice(0, 40)}`,
    developmentRunId: checkpoint.developmentRunId,
    sequence,
    requestId,
    commandKind,
    eventType,
    aggregateRevision: checkpoint.aggregate.run.revision,
    payload,
    payloadHash: developmentStorageHash(payload),
    occurredAt,
  };
}

function receipt(
  requestId: string,
  commandKind: DevelopmentCommandKind,
  aggregateRevision: number,
  result: unknown,
  accepted: boolean,
  recordedAt: string,
): DevelopmentCommandReceipt {
  return developmentCommandReceiptSchema.parse({
    requestId,
    commandKind,
    status: accepted ? "committed" : "rejected",
    aggregateRevision,
    resultHash: developmentStorageHash(result),
    recordedAt,
  });
}

export function newDurableDevelopmentCheckpoint(input: {
  aggregate: DevelopmentAggregate;
  workspaceHash: string;
  createdAt: string;
}): DurableDevelopmentCheckpoint {
  return parseDurableDevelopmentCheckpoint({
    schemaVersion: DEVELOPMENT_CHECKPOINT_SCHEMA_VERSION,
    developmentRunId: input.aggregate.run.developmentRunId,
    aggregate: input.aggregate,
    safeBoundary: "created",
    workspaceHash: input.workspaceHash,
    modelSnapshots: [],
    contextSnapshots: [],
    patchJournal: [],
    evidenceManifests: [],
    verificationArtifacts: [],
    commandResults: [],
    commandReceipts: {},
    recoveryAudits: [],
    lastEventSequence: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export async function initializeDevelopmentCheckpoint(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  input: {
    key: string;
    requestId: string;
    aggregate: DevelopmentAggregate;
    workspaceHash: string;
    occurredAt: string;
  },
): Promise<VersionedDevelopmentCheckpoint<DurableDevelopmentCheckpoint>> {
  let checkpoint = newDurableDevelopmentCheckpoint({
    aggregate: input.aggregate,
    workspaceHash: input.workspaceHash,
    createdAt: input.occurredAt,
  });
  const initializationResult = { initialized: true };
  checkpoint = parseDurableDevelopmentCheckpoint({
    ...checkpoint,
    commandReceipts: {
      [input.requestId]: receipt(
        input.requestId,
        "start",
        input.aggregate.run.revision,
        initializationResult,
        true,
        input.occurredAt,
      ),
    },
    lastEventSequence: 1,
  });
  return store.commit(
    input.key,
    null,
    checkpoint,
    [makeEvent(checkpoint, input.requestId, "start", input.occurredAt)],
    input.occurredAt,
  );
}

export async function executeDevelopmentCheckpointCommand(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  input: ExecuteDevelopmentCheckpointCommandInput,
): Promise<DevelopmentCheckpointCommandOutcome> {
  const stored = await store.load(input.key);
  if (!stored) throw new Error("Development Checkpoint not found");
  const checkpoint = parseDurableDevelopmentCheckpoint(stored.value);
  const existing = checkpoint.commandReceipts[input.requestId];
  if (existing) {
    return {
      checkpointRevision: stored.revision,
      checkpoint,
      result: existing,
      replayed: true,
    };
  }
  const mutation = input.mutate(checkpoint);
  if (mutation.aggregate.run.developmentRunId !== checkpoint.developmentRunId) {
    throw new Error("Mutation changed the Development Run identity");
  }
  const next = parseDurableDevelopmentCheckpoint({
    ...checkpoint,
    aggregate: mutation.aggregate,
    safeBoundary: mutation.safeBoundary,
    workspaceHash: mutation.workspaceHash ?? checkpoint.workspaceHash,
    ...appendArtifacts(checkpoint, mutation.artifacts),
    commandReceipts: {
      ...checkpoint.commandReceipts,
      [input.requestId]: receipt(
        input.requestId,
        input.commandKind,
        mutation.aggregate.run.revision,
        mutation.result,
        mutation.accepted,
        input.occurredAt,
      ),
    },
    pendingOperation: undefined,
    lastEventSequence: checkpoint.lastEventSequence + 1,
    updatedAt: input.occurredAt,
  });
  const committed = await store.commit(
    input.key,
    input.expectedRevision,
    next,
    [makeEvent(next, input.requestId, input.commandKind, input.occurredAt,
      input.commandKind === "cancel" ? "development.cancelled" : "development.state_changed")],
    input.occurredAt,
  );
  return {
    checkpointRevision: committed.revision,
    checkpoint: committed.value,
    result: mutation.result,
    replayed: false,
  };
}

export async function prepareDevelopmentOperation(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  input: {
    key: string;
    expectedRevision: number;
    operation: DevelopmentPendingOperation;
  },
): Promise<VersionedDevelopmentCheckpoint<DurableDevelopmentCheckpoint>> {
  const stored = await store.load(input.key);
  if (!stored) throw new Error("Development Checkpoint not found");
  const checkpoint = parseDurableDevelopmentCheckpoint(stored.value);
  const operation = developmentPendingOperationSchema.parse(input.operation);
  if (checkpoint.commandReceipts[operation.requestId]) return stored;
  if (checkpoint.pendingOperation) {
    if (contentHash(checkpoint.pendingOperation) === contentHash(operation)) return stored;
    throw new Error("Another Development operation is already pending");
  }
  if (operation.beforeWorkspaceHash !== checkpoint.workspaceHash) {
    throw new Error("Pending operation Workspace Hash is stale");
  }
  const next = parseDurableDevelopmentCheckpoint({
    ...checkpoint,
    pendingOperation: operation,
    lastEventSequence: checkpoint.lastEventSequence + 1,
    updatedAt: operation.startedAt,
  });
  return store.commit(
    input.key,
    input.expectedRevision,
    next,
    [makeEvent(next, operation.requestId, operation.commandKind, operation.startedAt)],
    operation.startedAt,
  );
}

export async function controlDurableDevelopmentRun(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  input: { key: string; expectedRevision: number; command: DevelopmentControlCommand },
): Promise<DevelopmentCheckpointCommandOutcome> {
  const command = developmentControlCommandSchema.parse(input.command);
  const kind = command.action;
  return executeDevelopmentCheckpointCommand(store, {
    key: input.key,
    expectedRevision: input.expectedRevision,
    requestId: command.requestId,
    commandKind: kind,
    occurredAt: command.occurredAt,
    mutate: (checkpoint) => {
      if (checkpoint.pendingOperation && command.action !== "cancel") {
        throw new Error("Pause or Resume cannot cross a pending side effect");
      }
      const execution = controlDevelopmentRun(checkpoint.aggregate, command);
      return {
        aggregate: execution.aggregate,
        safeBoundary: command.action === "pause"
          ? "paused"
          : command.action === "cancel"
            ? "cancelled"
            : "task_ready",
        result: execution.result,
        accepted: execution.result.accepted,
      };
    },
  });
}

export async function publishPendingDevelopmentEvents(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  key: string,
  publisher: DevelopmentOutboxPublisher,
  publishedAt: () => string,
): Promise<number> {
  let stored = await store.load(key);
  if (!stored) throw new Error("Development Checkpoint not found");
  for (const event of await store.pendingOutbox(key)) {
    await publisher.publish(event);
    stored = await store.markOutboxPublished(
      key,
      stored.revision,
      [event.eventId],
      publishedAt(),
    );
  }
  return stored.revision;
}

function recoveryAudit(input: {
  checkpoint: DurableDevelopmentCheckpoint;
  checkpointRevision: number;
  requestId: string;
  reason: DevelopmentRecoveryAudit["reason"];
  disposition: DevelopmentRecoveryAudit["disposition"];
  actualWorkspaceHash: string;
  auditedAt: string;
}): DevelopmentRecoveryAudit {
  return developmentRecoveryAuditSchema.parse({
    auditId: `recovery-audit:${contentHash([
      input.checkpoint.developmentRunId,
      input.requestId,
    ]).slice(0, 40)}`,
    developmentRunId: input.checkpoint.developmentRunId,
    checkpointRevision: input.checkpointRevision,
    reason: input.reason,
    disposition: input.disposition,
    envelopeHash: input.checkpoint.aggregate.input.envelopeHash,
    expectedWorkspaceHash: input.checkpoint.workspaceHash,
    actualWorkspaceHash: input.actualWorkspaceHash,
    ...(input.checkpoint.pendingOperation
      ? { pendingRequestId: input.checkpoint.pendingOperation.requestId }
      : {}),
    auditedAt: input.auditedAt,
  });
}

export async function recoverDevelopmentCheckpoint(
  store: DevelopmentCheckpointStore<DurableDevelopmentCheckpoint>,
  input: {
    key: string;
    requestId: string;
    expectedRevision: number;
    currentEnvelope: DevelopmentStartEnvelope;
    actualWorkspaceHash: string;
    auditedAt: string;
  },
): Promise<DevelopmentRecoveryOutcome> {
  const stored = await store.load(input.key);
  if (!stored) throw new Error("Development Checkpoint not found");
  let checkpoint = parseDurableDevelopmentCheckpoint(stored.value);
  const priorReceipt = checkpoint.commandReceipts[input.requestId];
  const priorAudit = checkpoint.recoveryAudits.find(
    (audit) => audit.auditId === `recovery-audit:${contentHash([
      checkpoint.developmentRunId,
      input.requestId,
    ]).slice(0, 40)}`,
  );
  if (priorReceipt && priorAudit) {
    return {
      checkpointRevision: stored.revision,
      checkpoint,
      audit: priorAudit,
      replayed: true,
    };
  }
  const envelope = developmentStartEnvelopeSchema.parse(input.currentEnvelope);
  const envelopeMatches = contentHash(envelope) === checkpoint.aggregate.input.envelopeHash;
  let reason: DevelopmentRecoveryAudit["reason"] = "safe_boundary";
  let disposition: DevelopmentRecoveryAudit["disposition"] = "resume";
  let safeBoundary = checkpoint.safeBoundary;
  let aggregate = checkpoint.aggregate;
  let pendingOperation = checkpoint.pendingOperation;
  let workspaceHash = checkpoint.workspaceHash;

  if (!envelopeMatches) {
    reason = "planning_stale";
    disposition = "blocked";
    safeBoundary = "recovery_required";
  } else if (pendingOperation?.operation === "applying_patch") {
    if (input.actualWorkspaceHash === pendingOperation.beforeWorkspaceHash) {
      reason = "safe_boundary";
      disposition = "resume";
    } else if (input.actualWorkspaceHash === pendingOperation.expectedAfterWorkspaceHash) {
      const task = pendingOperation.taskRunId
        ? aggregate.taskRuns[pendingOperation.taskRunId]
        : undefined;
      if (!task || task.status !== "applying_patch") {
        reason = "uncertain_patch";
        disposition = "manual_review";
        safeBoundary = "recovery_required";
      } else {
        const transition = transitionTask(aggregate, {
          requestId: `finalize:${pendingOperation.requestId}`,
          taskRunId: task.taskRunId,
          toStatus: "verifying",
          transitionedAt: input.auditedAt,
        });
        if (!transition.result.accepted) {
          reason = "uncertain_patch";
          disposition = "manual_review";
          safeBoundary = "recovery_required";
        } else {
          aggregate = transition.aggregate;
          workspaceHash = input.actualWorkspaceHash;
          if (!pendingOperation.preparedPatchJournal) {
            throw new Error("Recovered Patch is missing its prepared Journal");
          }
          checkpoint = {
            ...checkpoint,
            patchJournal: appendUnique(
              checkpoint.patchJournal,
              [pendingOperation.preparedPatchJournal],
              (item) => item.journalEntryId,
            ),
          };
          pendingOperation = undefined;
          reason = "safe_boundary";
          disposition = "finalize_patch";
          safeBoundary = "patch_committed";
        }
      }
    } else {
      reason = "uncertain_patch";
      disposition = "manual_review";
      safeBoundary = "recovery_required";
    }
  } else if (input.actualWorkspaceHash !== checkpoint.workspaceHash) {
    reason = "workspace_drift";
    disposition = "blocked";
    safeBoundary = "recovery_required";
  } else if (pendingOperation?.operation === "verifying") {
    reason = "verification_interrupted";
    disposition = "resume_verification";
  } else if (pendingOperation?.operation === "repairing") {
    reason = "repair_interrupted";
    disposition = "manual_review";
    safeBoundary = "recovery_required";
  } else if (Object.values(aggregate.taskRuns).some(({ status }) => status === "applying_patch")) {
    reason = "uncertain_patch";
    disposition = "manual_review";
    safeBoundary = "recovery_required";
  } else if (Object.values(aggregate.taskRuns).some(({ status }) => status === "verifying")) {
    reason = "verification_interrupted";
    disposition = "resume_verification";
  } else if (Object.values(aggregate.taskRuns).some(({ status }) => status === "repairing")) {
    reason = "repair_interrupted";
    disposition = "manual_review";
    safeBoundary = "recovery_required";
  }

  const audit = recoveryAudit({
    checkpoint,
    checkpointRevision: stored.revision,
    requestId: input.requestId,
    reason,
    disposition,
    actualWorkspaceHash: input.actualWorkspaceHash,
    auditedAt: input.auditedAt,
  });
  const result = { reason, disposition };
  checkpoint = parseDurableDevelopmentCheckpoint({
    ...checkpoint,
    aggregate,
    safeBoundary,
    workspaceHash,
    recoveryAudits: [...checkpoint.recoveryAudits, audit],
    commandReceipts: {
      ...checkpoint.commandReceipts,
      [input.requestId]: receipt(
        input.requestId,
        "recovery",
        aggregate.run.revision,
        result,
        disposition !== "blocked",
        input.auditedAt,
      ),
    },
    ...(pendingOperation ? { pendingOperation } : { pendingOperation: undefined }),
    lastEventSequence: checkpoint.lastEventSequence + 1,
    updatedAt: input.auditedAt,
  });
  const committed = await store.commit(
    input.key,
    input.expectedRevision,
    checkpoint,
    [makeEvent(
      checkpoint,
      input.requestId,
      "recovery",
      input.auditedAt,
      disposition === "manual_review" || disposition === "blocked"
        ? "development.recovery_required"
        : "development.state_changed",
    )],
    input.auditedAt,
  );
  return {
    checkpointRevision: committed.revision,
    checkpoint: committed.value,
    audit,
    replayed: false,
  };
}
