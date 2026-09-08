import { describe, expect, it } from "vitest";

import { InMemoryDevelopmentCheckpointStore } from "@product-woc/development-adapters";
import {
  initializeDevelopmentCheckpoint,
  parseDurableDevelopmentCheckpoint,
  type DurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";
import { loadRuntimeConfiguration } from "@product-woc/runtime-config";

import {
  DevelopmentLabApplication,
  DevelopmentLabError,
  developmentCheckpointKey,
  developmentViewFrom,
  type DevelopmentLabActor,
} from "../src/application.js";
import { at, checkpointFixture, richCheckpointFixture } from "./fixtures.js";

const editor: DevelopmentLabActor = { workspaceId: "local-workspace", actorId: "local-user", role: "editor" };
const viewer: DevelopmentLabActor = { workspaceId: "local-workspace", actorId: "viewer", role: "viewer" };

async function setup(checkpoint: DurableDevelopmentCheckpoint = checkpointFixture()) {
  const store = new InMemoryDevelopmentCheckpointStore(parseDurableDevelopmentCheckpoint);
  const initialized = await initializeDevelopmentCheckpoint(store, {
    key: developmentCheckpointKey("local-workspace", "demo-project"),
    requestId: "initialize-lab-test", aggregate: checkpoint.aggregate,
    workspaceHash: checkpoint.workspaceHash, occurredAt: at,
  });
  return { store, initialized, application: new DevelopmentLabApplication(store, {
    retry: async ({ checkpoint: current }) => current.aggregate,
  }) };
}

describe("Development Lab Application", () => {
  it("projects DAG, traceability, model, Context and log views from one Checkpoint", () => {
    const view = developmentViewFrom(7, richCheckpointFixture(), editor, {});
    expect(view.checkpointRevision).toBe(7);
    expect(view.phases.flatMap(({ tasks }) => tasks)).toHaveLength(2);
    expect(view.phases[0]?.tasks[0]).toMatchObject({
      requirementIds: ["REQ-1"], acceptanceCriterionIds: ["AC-1"],
    });
    expect(view.models.snapshots[0]).toMatchObject({ selectionSource: "stage_override" });
    expect(view.models).toMatchObject({
      configurationAuthority: "developer_operator",
      webEditable: false,
    });
    expect(view.contexts).toHaveLength(1);
    expect(view.verification.logs[0]?.content).toBe("all checks passed");
    expect(view.actions).not.toContain("deploy");
  });

  it("makes Web view and exported CLI Evidence agree on the same Checkpoint", async () => {
    const { application } = await setup(richCheckpointFixture());
    const view = await application.get("local-workspace", "demo-project", editor);
    const bundle = await application.exportEvidence("local-workspace", "demo-project", editor) as {
      developmentRunId: string; workspaceHash: string;
    };
    expect(bundle.developmentRunId).toBe(view.developmentRunId);
    expect(bundle.workspaceHash).toBe(view.workspaceHash);
  });

  it("enforces role, Workspace, Revision, Hash and idempotent Pause", async () => {
    const { application, initialized } = await setup();
    await expect(application.control(
      "local-workspace", "demo-project", "pause", "viewer request",
      { idempotencyKey: "pause-viewer", checkpointRevision: initialized.revision, workspaceHash: "c".repeat(64) },
      viewer, at,
    )).rejects.toMatchObject({ code: "forbidden" });
    await expect(application.get("other-workspace", "demo-project", editor)).rejects.toBeInstanceOf(DevelopmentLabError);
    await expect(application.control(
      "local-workspace", "demo-project", "pause", "stale revision",
      { idempotencyKey: "pause-stale", checkpointRevision: 99, workspaceHash: "c".repeat(64) },
      editor, at,
    )).rejects.toMatchObject({ code: "conflict" });
    const paused = await application.control(
      "local-workspace", "demo-project", "pause", "pause safely",
      { idempotencyKey: "pause-once", checkpointRevision: initialized.revision, workspaceHash: "c".repeat(64) },
      editor, at,
    );
    const replayed = await application.control(
      "local-workspace", "demo-project", "pause", "pause safely",
      { idempotencyKey: "pause-once", checkpointRevision: paused.checkpointRevision, workspaceHash: paused.workspaceHash },
      editor, at,
    );
    expect(replayed.status).toBe("paused");
    expect(replayed.checkpointRevision).toBe(paused.checkpointRevision);
  });

  it("shows clear Stale, drift and manual recovery blockers", () => {
    const current = checkpointFixture();
    const blocked = parseDurableDevelopmentCheckpoint({
      ...current,
      safeBoundary: "recovery_required",
      recoveryAudits: [{
        auditId: "audit-1", developmentRunId: current.developmentRunId,
        checkpointRevision: 2, reason: "workspace_drift", disposition: "blocked",
        envelopeHash: current.aggregate.input.envelopeHash,
        expectedWorkspaceHash: current.workspaceHash, actualWorkspaceHash: "d".repeat(64), auditedAt: at,
      }],
    });
    const view = developmentViewFrom(2, blocked, editor);
    expect(view.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "workspace_drift" })]));
  });

  it("projects model configuration as the same sanitized read-only view for every Web role", async () => {
    const { application } = await setup();
    const editorView = await application.get("local-workspace", "demo-project", editor);
    const viewerView = await application.get("local-workspace", "demo-project", viewer);
    expect(editorView.models).toEqual(viewerView.models);
    expect(editorView.models.webEditable).toBe(false);
    expect(editorView.models.configurationAuthority).toBe("developer_operator");
    expect(editorView.models.stages).toHaveLength(7);
    expect(JSON.stringify(editorView.models)).not.toContain("credentialRef");
    expect(JSON.stringify(editorView.models)).not.toContain("endpointRef");
    expect(editorView.permissions).not.toHaveProperty("canConfigureStageModels");
  });

  it("projects unavailable operator configuration without leaking diagnostics", async () => {
    const { store } = await setup();
    const runtime = await loadRuntimeConfiguration({
      configPath: "/tmp/product-woc-development-config-does-not-exist.json",
      environment: {},
    });
    const application = new DevelopmentLabApplication(
      store,
      {},
      undefined,
      runtime,
    );
    const view = await application.get("local-workspace", "demo-project", editor);
    expect(view.models.status).toBe("unavailable");
    expect(view.models.stages).toHaveLength(7);
    expect(JSON.stringify(view.models)).not.toContain(runtime.sourcePath);
    expect(JSON.stringify(view.models)).not.toContain("diagnostics");
  });
});
