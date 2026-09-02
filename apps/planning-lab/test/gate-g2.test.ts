import { describe, expect, it } from "vitest";

import { InMemoryTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import type { DurableStandalonePlanningCheckpoint } from "@product-woc/planning-workflow";

import {
  PlanningWebController,
  type PlanningPageViewModel,
  type PlanningWebActor,
} from "../src/web-controller.js";

const actor: PlanningWebActor = {
  workspaceId: "gate-g2-workspace",
  actorId: "product-owner",
  role: "editor",
};

function approvalBinding(view: PlanningPageViewModel, key: string) {
  if (!view.currentSubject || !view.currentVersionId || !view.currentHash) {
    throw new Error("Expected an approval gate");
  }
  return {
    idempotencyKey: key,
    subject: view.currentSubject,
    versionId: view.currentVersionId,
    hash: view.currentHash,
  };
}

async function completeProject(
  controller: PlanningWebController,
  projectId: string,
  idea: string,
): Promise<PlanningPageViewModel> {
  const spec = await controller.start(
    {
      workspaceId: actor.workspaceId,
      projectId,
      requestedBy: actor.actorId,
      requestId: `start-${projectId}`,
      idea,
    },
    actor,
  );
  const design = await controller.approve(
    actor.workspaceId,
    projectId,
    approvalBinding(spec, `approve-spec-${projectId}`),
    actor,
  );
  const plan = await controller.approve(
    actor.workspaceId,
    projectId,
    approvalBinding(design, `approve-design-${projectId}`),
    actor,
  );
  return controller.approve(
    actor.workspaceId,
    projectId,
    approvalBinding(plan, `approve-plan-${projectId}`),
    actor,
  );
}

describe("standalone Gate G2", () => {
  it("completes five distinct products with decision summaries and unique starts", async () => {
    const store =
      new InMemoryTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>();
    const controller = new PlanningWebController(store);
    const ideas = [
      "Build a private customer feedback tracker",
      "创建一个内部活动报名和审核工具",
      "Build 一个内容选题与编辑审批看板",
      "Create a lightweight expense request workflow",
      "制作一个单工作区销售线索跟进工具",
    ];
    const completed = await Promise.all(
      ideas.map((idea, index) =>
        completeProject(controller, `gate-project-${index + 1}`, idea),
      ),
    );

    expect(completed.every(({ status }) => status === "ready_for_development")).toBe(
      true,
    );
    expect(
      completed.every(
        ({ documents }) =>
          documents.length === 3 &&
          documents.every(({ summary, markdown }) =>
            Boolean(Object.keys(summary).length > 0 && markdown.length > 0),
          ),
      ),
    ).toBe(true);
    expect(
      new Set(completed.map(({ developmentStart }) => developmentStart?.envelopeId))
        .size,
    ).toBe(5);
  });

  it("revises an approved spec and invalidates every old downstream authority", async () => {
    const store =
      new InMemoryTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>();
    const controller = new PlanningWebController(store);
    const projectId = "gate-revision-project";
    const ready = await completeProject(
      controller,
      projectId,
      "Build a private issue tracking workflow",
    );
    const oldEnvelope = ready.developmentStart;
    const oldSpec = ready.documents.find(({ subject }) => subject === "project_spec");
    if (!oldEnvelope || !oldSpec) throw new Error("Expected completed planning state");

    const revised = await controller.revise(
      actor.workspaceId,
      projectId,
      {
        idempotencyKey: "gate-revise-approved-spec",
        subject: "project_spec",
        versionId: oldSpec.versionId,
        hash: oldSpec.hash,
        feedback: "Restrict the MVP to a single private workspace",
      },
      actor,
    );
    const invalidated = await store.load(`${actor.workspaceId}:${projectId}`);

    expect(revised).toMatchObject({
      status: "awaiting_product_spec_approval",
      approvals: 0,
      documents: [
        { subject: "project_spec", version: 2, valid: true },
        { subject: "technical_design", valid: false },
        { subject: "execution_plan", valid: false },
      ],
    });
    expect(revised.developmentStart).toBeUndefined();
    expect(invalidated?.value.aggregate.effectiveApprovals).toEqual({});
    expect(invalidated?.value.aggregate.invalidations.slice(-3)).toHaveLength(3);

    const design = await controller.approve(
      actor.workspaceId,
      projectId,
      approvalBinding(revised, "gate-reapprove-spec"),
      actor,
    );
    const plan = await controller.approve(
      actor.workspaceId,
      projectId,
      approvalBinding(design, "gate-reapprove-design"),
      actor,
    );
    const planBinding = approvalBinding(plan, "gate-reapprove-plan");
    const reready = await controller.approve(
      actor.workspaceId,
      projectId,
      planBinding,
      actor,
    );
    const replayed = await controller.approve(
      actor.workspaceId,
      projectId,
      planBinding,
      actor,
    );

    expect(reready.developmentStart?.envelopeId).not.toBe(oldEnvelope.envelopeId);
    expect(replayed.developmentStart).toEqual(reready.developmentStart);
    expect(replayed.approvals).toBe(3);
  });
});
