import {
  FileDevelopmentCheckpointStore,
  NodeWorkspaceAdapter,
} from "@product-woc/development-adapters";
import { createDevelopmentAggregate, contentHash, startDevelopmentRun } from "@product-woc/development-domain";
import {
  executeDevelopmentCheckpointCommand,
  initializeDevelopmentCheckpoint,
  parseDurableDevelopmentCheckpoint,
  type DurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";
import { FileTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import type { DurableStandalonePlanningCheckpoint } from "@product-woc/planning-workflow";

import { developmentCheckpointKey } from "./application.js";

export interface BootstrapDevelopmentInput {
  workspaceId: string;
  projectId: string;
  actorId: string;
  workspaceRoot: string;
  planningDataDirectory: string;
  developmentDataDirectory: string;
  requestId: string;
  occurredAt: string;
}

export async function bootstrapAndStartDevelopmentFromPlanning(
  input: BootstrapDevelopmentInput,
): Promise<{
  resumed: boolean;
  checkpointRevision: number;
  checkpoint: DurableDevelopmentCheckpoint;
}> {
  const bootstrapped = await bootstrapDevelopmentFromPlanning(input);
  if (bootstrapped.checkpoint.aggregate.run.status !== "ready") return bootstrapped;
  const key = developmentCheckpointKey(input.workspaceId, input.projectId);
  const store = new FileDevelopmentCheckpointStore(
    input.developmentDataDirectory,
    parseDurableDevelopmentCheckpoint,
  );
  const started = await executeDevelopmentCheckpointCommand(store, {
    key,
    expectedRevision: bootstrapped.checkpointRevision,
    requestId: `${input.requestId}:start`,
    commandKind: "start",
    occurredAt: input.occurredAt,
    mutate: (current) => {
      const execution = startDevelopmentRun(current.aggregate, {
        requestId: `domain:${input.requestId}:start`,
        startedAt: input.occurredAt,
      });
      return {
        aggregate: execution.aggregate,
        safeBoundary: execution.result.accepted ? "task_ready" : current.safeBoundary,
        result: execution.result,
        accepted: execution.result.accepted,
      };
    },
  });
  return {
    resumed: bootstrapped.resumed,
    checkpointRevision: started.checkpointRevision,
    checkpoint: started.checkpoint,
  };
}

export async function bootstrapDevelopmentFromPlanning(
  input: BootstrapDevelopmentInput,
): Promise<{
  resumed: boolean;
  checkpointRevision: number;
  checkpoint: DurableDevelopmentCheckpoint;
}> {
  const key = developmentCheckpointKey(input.workspaceId, input.projectId);
  const developmentStore = new FileDevelopmentCheckpointStore(
    input.developmentDataDirectory,
    parseDurableDevelopmentCheckpoint,
  );
  const existing = await developmentStore.load(key);
  if (existing) {
    return { resumed: true, checkpointRevision: existing.revision, checkpoint: existing.value };
  }

  const planningStore = new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
    input.planningDataDirectory,
  );
  const planning = await planningStore.load(`${input.workspaceId}:${input.projectId}`);
  const checkpoint = planning?.value;
  const envelope = checkpoint?.aggregate.developmentStart;
  if (
    !checkpoint ||
    checkpoint.aggregate.snapshot.status !== "ready_for_development" ||
    !envelope ||
    !checkpoint.projectSpec ||
    !checkpoint.technicalDesign ||
    !checkpoint.executionPlan
  ) {
    throw new Error("A completed local Planning Checkpoint with a valid Envelope is required");
  }
  const workspaceHash = new NodeWorkspaceAdapter(input.workspaceRoot).contentManifestHash();
  const creation = createDevelopmentAggregate({
    creationRequestId: input.requestId,
    developmentRunId: `development-run:${contentHash([
      envelope.envelopeId,
      workspaceHash,
    ]).slice(0, 40)}`,
    envelope,
    authority: {
      snapshot: checkpoint.aggregate.snapshot,
      effectiveApprovals: Object.values(checkpoint.aggregate.effectiveApprovals),
      workflowDefinitionVersion: checkpoint.aggregate.config.workflowDefinitionVersion,
      workflowDefinitionChecksum: checkpoint.aggregate.config.workflowDefinitionChecksum,
      validationPolicyVersion: checkpoint.aggregate.config.validationPolicyVersion,
    },
    projectSpec: checkpoint.projectSpec,
    technicalDesign: checkpoint.technicalDesign,
    executionPlan: checkpoint.executionPlan,
    workspaceBaselineHash: workspaceHash,
    modelPolicySnapshotId: "local-model-policy",
    toolPolicyVersion: "1.0.0",
    createdAt: input.occurredAt,
  });
  if (!creation.created) {
    throw new Error(`Development input rejected: ${JSON.stringify(creation.issues)}`);
  }
  const initialized = await initializeDevelopmentCheckpoint(developmentStore, {
    key,
    requestId: input.requestId,
    aggregate: creation.aggregate,
    workspaceHash,
    occurredAt: input.occurredAt,
  });
  return {
    resumed: false,
    checkpointRevision: initialized.revision,
    checkpoint: initialized.value,
  };
}
