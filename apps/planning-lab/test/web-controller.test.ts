import { describe, expect, it } from "vitest";

import { InMemoryTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import type { DurableStandalonePlanningCheckpoint } from "@product-woc/planning-workflow";

import {
  PlanningWebController,
  PlanningWebError,
  type PlanningWebActor,
} from "../src/web-controller.js";

const editor: PlanningWebActor = {
  workspaceId: "workspace-a",
  actorId: "editor-a",
  role: "editor",
};
const request = {
  workspaceId: "workspace-a",
  projectId: "project-a",
  requestedBy: "editor-a",
  requestId: "start-project-a",
  idea: "Build a private customer feedback tracker",
} as const;

function controller(): PlanningWebController {
  return new PlanningWebController(
    new InMemoryTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(),
  );
}

function binding(
  view: Awaited<ReturnType<PlanningWebController["start"]>>,
  idempotencyKey: string,
) {
  if (!view.currentSubject || !view.currentVersionId || !view.currentHash) {
    throw new Error("Expected an approval gate");
  }
  return {
    idempotencyKey,
    subject: view.currentSubject,
    versionId: view.currentVersionId,
    hash: view.currentHash,
  };
}

describe("PlanningWebController", () => {
  it("moves through three explicit approval gates and replays a command once", async () => {
    const subject = controller();
    const spec = await subject.start(request, editor);
    expect(spec.status).toBe("awaiting_product_spec_approval");
    expect(spec.documents).toHaveLength(1);

    const design = await subject.approve(
      request.workspaceId,
      request.projectId,
      binding(spec, "approve-spec"),
      editor,
    );
    expect(design.status).toBe("awaiting_technical_design_approval");
    expect(design.approvals).toBe(1);

    const replayed = await subject.approve(
      request.workspaceId,
      request.projectId,
      { ...binding(design, "approve-design"), idempotencyKey: "approve-spec" },
      editor,
    );
    expect(replayed.status).toBe("awaiting_technical_design_approval");
    expect(replayed.approvals).toBe(1);

    const plan = await subject.approve(
      request.workspaceId,
      request.projectId,
      binding(design, "approve-design"),
      editor,
    );
    const ready = await subject.approve(
      request.workspaceId,
      request.projectId,
      binding(plan, "approve-plan"),
      editor,
    );
    expect(ready).toMatchObject({
      status: "ready_for_development",
      approvals: 3,
      permissions: { canApprove: false },
    });
    expect(ready.documents).toHaveLength(3);
    expect(ready.developmentStart?.approvalIds).toHaveLength(3);
  });

  it("regenerates a monotonic version after revision feedback", async () => {
    const subject = controller();
    const first = await subject.start(request, editor);
    const revised = await subject.revise(
      request.workspaceId,
      request.projectId,
      { ...binding(first, "revise-spec"), feedback: "Tighten the MVP scope" },
      editor,
    );
    expect(revised.status).toBe("awaiting_product_spec_approval");
    expect(revised.documents[0]?.version).toBe(2);
    expect(revised.currentVersionId).not.toBe(first.currentVersionId);
    expect(revised.currentHash).not.toBe(first.currentHash);
    expect(revised.documents[0]?.versions).toHaveLength(2);
    expect(revised.documents[0]?.versions[1]?.structuredDiff.length).toBeGreaterThan(0);
  });

  it("enforces role, workspace and stale document bindings", async () => {
    const subject = controller();
    const spec = await subject.start(request, editor);
    const viewer = { ...editor, role: "viewer" as const };

    await expect(
      subject.approve(
        request.workspaceId,
        request.projectId,
        binding(spec, "viewer-approve"),
        viewer,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(subject.get("workspace-b", request.projectId, editor)).rejects.toBeInstanceOf(
      PlanningWebError,
    );
    await expect(
      subject.approve(
        request.workspaceId,
        request.projectId,
        { ...binding(spec, "stale-approve"), hash: "0".repeat(64) },
        editor,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps secrets and PII out of checkpoints and rendered documents", async () => {
    const subject = controller();
    const privateRequest = {
      ...request,
      projectId: "security-redaction-project",
      requestId: "security-redaction-start",
      idea:
        "Build a tracker for owner@example.com using api_key=production-secret-value",
    };
    const first = await subject.start(privateRequest, editor);
    const revised = await subject.revise(
      privateRequest.workspaceId,
      privateRequest.projectId,
      {
        ...binding(first, "security-redaction-revise"),
        feedback: "Notify 13800138000 with password=another-secret-value",
      },
      editor,
    );
    const serialized = JSON.stringify(revised);

    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("production-secret-value");
    expect(serialized).not.toContain("13800138000");
    expect(serialized).not.toContain("another-secret-value");
    expect(serialized).toContain("[REDACTED:");
  });
});
