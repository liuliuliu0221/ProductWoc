import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  FileDevelopmentCheckpointStore,
  NodeWorkspaceAdapter,
} from "@product-woc/development-adapters";
import {
  parseDurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";
import { FileTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import type { DurableStandalonePlanningCheckpoint } from "@product-woc/planning-workflow";

import {
  DevelopmentLabApplication,
  type DevelopmentLabActor,
} from "./application.js";
import { bootstrapAndStartDevelopmentFromPlanning } from "./bootstrap.js";
import { createLocalDevelopmentActions } from "./local-actions.js";
import { parseDevelopmentCliArguments } from "./cli-arguments.js";

const { command, positional } = parseDevelopmentCliArguments(process.argv.slice(2));
const workspaceRoot = resolve(process.env.PRODUCT_WOC_WORKSPACE_ROOT ?? process.cwd());
const workspaceId = process.env.PRODUCT_WOC_WORKSPACE_ID ?? "local-workspace";
const projectId = process.env.PRODUCT_WOC_PROJECT_ID ?? "demo-project";
const actorId = process.env.PRODUCT_WOC_USER_ID ?? "local-user";
const planningDirectory = process.env.PRODUCT_WOC_PLANNING_DATA_DIR ?? join(workspaceRoot, ".product-woc", "checkpoints");
const developmentDirectory = process.env.PRODUCT_WOC_DEVELOPMENT_DATA_DIR ?? join(workspaceRoot, ".product-woc", "development-checkpoints");
const actor: DevelopmentLabActor = { workspaceId, actorId, role: "editor" };
const store = new FileDevelopmentCheckpointStore(developmentDirectory, parseDurableDevelopmentCheckpoint);
const application = new DevelopmentLabApplication(store, createLocalDevelopmentActions(workspaceRoot));

function now(): string {
  return new Date().toISOString();
}

function requestId(scope: string): string {
  return `cli:${scope}:${Date.now()}:${process.pid}`;
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function currentView() {
  return application.get(workspaceId, projectId, actor);
}

async function binding(scope: string) {
  const view = await currentView();
  return {
    view,
    value: {
      idempotencyKey: requestId(scope),
      checkpointRevision: view.checkpointRevision,
      workspaceHash: view.workspaceHash,
    },
  };
}

async function develop(): Promise<void> {
  const bootstrapped = await bootstrapAndStartDevelopmentFromPlanning({
    workspaceId,
    projectId,
    actorId,
    workspaceRoot,
    planningDataDirectory: planningDirectory,
    developmentDataDirectory: developmentDirectory,
    requestId: `cli:develop:${projectId}`,
    occurredAt: now(),
  });
  print({
    command: "develop",
    resumed: bootstrapped.resumed,
    externalServicesUsed: [],
    checkpointRevision: bootstrapped.checkpointRevision,
    status: bootstrapped.checkpoint.aggregate.run.status,
    currentTaskRunId: bootstrapped.checkpoint.aggregate.run.currentTaskRunId,
    workspaceHash: bootstrapped.checkpoint.workspaceHash,
  });
}

async function status(): Promise<void> {
  const view = await currentView();
  print({
    command: "status",
    developmentRunId: view.developmentRunId,
    status: view.status,
    safeBoundary: view.safeBoundary,
    checkpointRevision: view.checkpointRevision,
    workspaceHash: view.workspaceHash,
    phases: view.phases.map(({ executionPhaseId, status: phaseStatus, tasks }) => ({
      executionPhaseId,
      status: phaseStatus,
      tasks: tasks.map(({ executionTaskId, status: taskStatus, evidenceCount }) => ({
        executionTaskId,
        status: taskStatus,
        evidenceCount,
      })),
    })),
    currentTask: view.currentTask,
    blockers: view.blockers,
  });
}

async function resume(): Promise<void> {
  const current = await binding("resume");
  const planning = await new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(planningDirectory)
    .load(`${workspaceId}:${projectId}`);
  const envelope = planning?.value.aggregate.developmentStart;
  if (!envelope) throw new Error("Current Planning Envelope is unavailable");
  let view = await application.recover(
    workspaceId,
    projectId,
    envelope,
    new NodeWorkspaceAdapter(workspaceRoot).contentManifestHash(),
    current.value,
    actor,
    now(),
  );
  if (view.status === "paused" && !view.blockers.length) {
    view = await application.control(
      workspaceId,
      projectId,
      "resume",
      "Resume from CLI after recovery audit",
      {
        idempotencyKey: `${current.value.idempotencyKey}:control`,
        checkpointRevision: view.checkpointRevision,
        workspaceHash: view.workspaceHash,
      },
      actor,
      now(),
    );
  }
  print({ command: "resume", status: view.status, checkpointRevision: view.checkpointRevision, blockers: view.blockers });
}

async function runAction(kind: "verify" | "rollback"): Promise<void> {
  const current = await binding(kind);
  const view = await application.action(
    workspaceId,
    projectId,
    kind,
    current.value,
    actor,
    now(),
  );
  print({ command: kind, status: view.status, checkpointRevision: view.checkpointRevision, currentTask: view.currentTask, blockers: view.blockers });
}

async function models(): Promise<void> {
  const view = await currentView();
  print({ command: "models", ...view.models });
}

async function exportEvidence(): Promise<void> {
  const bundle = await application.exportEvidence(workspaceId, projectId, actor);
  const output = resolve(positional[0] ?? `product-woc-evidence-${projectId}.json`);
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  print({ command: "export-evidence", output, redacted: true });
}

async function main(): Promise<void> {
  if (command === "develop") return develop();
  if (command === "status") return status();
  if (command === "resume") return resume();
  if (command === "verify") return runAction("verify");
  if (command === "rollback") return runAction("rollback");
  if (command === "models") return models();
  if (command === "export-evidence") return exportEvidence();
  throw new Error("Unknown command. Use develop, status, resume, verify, rollback, models, or export-evidence.");
}

main().catch((error) => {
  process.stderr.write(`ProductWoc Development CLI failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
