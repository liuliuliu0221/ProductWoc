import { randomUUID } from "node:crypto";

import {
  FileTransactionalCheckpointStore,
  SystemClock,
  type TransactionalCheckpointStore,
} from "@product-woc/planning-adapters";
import type {
  PlanningStatusV2,
  PlanningSubject,
} from "@product-woc/planning-contracts";
import {
  diffJson,
  renderExecutionPlanMarkdown,
  renderProjectSpecMarkdown,
  renderTechnicalDesignMarkdown,
  summarizeExecutionPlan,
  summarizeProjectSpec,
  summarizeTechnicalDesign,
} from "@product-woc/planning-renderer";
import {
  cancelDurablePlanning,
  createInMemoryStandalonePlanningPorts,
  returnDurablePlanningSubject,
  runDurableStandalonePlanning,
  StandalonePlanningError,
  type ApprovalGateStatus,
  type DurableStandalonePlanningCheckpoint,
  type StandalonePlanningPorts,
  type StandalonePlanningRequest,
} from "@product-woc/planning-workflow";

export type PlanningWebRole = "viewer" | "editor";

export interface PlanningWebActor {
  workspaceId: string;
  actorId: string;
  role: PlanningWebRole;
}

export interface PlanningDocumentView {
  subject: PlanningSubject;
  label: string;
  version: number;
  versionId: string;
  hash: string;
  valid: boolean;
  approved: boolean;
  summary: object;
  markdown: string;
  versions: readonly {
    version: number;
    versionId: string;
    hash: string;
    structuredDiff: ReturnType<typeof diffJson>;
  }[];
}

export interface PlanningPageViewModel {
  workspaceId: string;
  projectId: string;
  idea: string;
  status: PlanningStatusV2;
  statusLabel: string;
  checkpointRevision: number;
  snapshotRevision: number;
  currentSubject?: PlanningSubject;
  currentVersionId?: string;
  currentHash?: string;
  documents: readonly PlanningDocumentView[];
  approvals: number;
  discovery?: {
    summary: string;
    assumptions: readonly string[];
    risks: readonly string[];
    questions: readonly string[];
  };
  timeline: readonly {
    stage: string;
    label: string;
    state: "done" | "active" | "pending";
  }[];
  permissions: {
    canApprove: boolean;
    canRevise: boolean;
    canCancel: boolean;
  };
  developmentStart?: DurableStandalonePlanningCheckpoint["aggregate"]["developmentStart"];
}

export class PlanningWebError extends Error {
  public constructor(
    public readonly code:
      | "forbidden"
      | "not_found"
      | "conflict"
      | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "PlanningWebError";
  }
}

const statusLabels: Record<PlanningStatusV2, string> = {
  collecting_idea: "正在收集想法",
  analyzing_request: "正在理解需求",
  awaiting_clarification: "等待补充信息",
  generating_product_spec: "正在生成产品规格",
  awaiting_product_spec_approval: "等待产品规格确认",
  generating_technical_design: "正在生成技术设计",
  awaiting_technical_design_approval: "等待技术设计确认",
  generating_execution_plan: "正在生成执行计划",
  awaiting_execution_plan_approval: "等待执行计划确认",
  needs_user_action: "需要你的处理",
  ready_for_development: "已准备进入开发",
  cancelled: "规划已取消",
};

const gateSubject: Partial<Record<PlanningStatusV2, PlanningSubject>> = {
  awaiting_product_spec_approval: "project_spec",
  awaiting_technical_design_approval: "technical_design",
  awaiting_execution_plan_approval: "execution_plan",
};

function checkpointKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function assertWorkspace(actor: PlanningWebActor, workspaceId: string): void {
  if (actor.workspaceId !== workspaceId) {
    throw new PlanningWebError("forbidden", "Cross-workspace access is not allowed");
  }
}

function assertEditor(actor: PlanningWebActor): void {
  if (actor.role !== "editor") {
    throw new PlanningWebError("forbidden", "Editor role is required");
  }
}

function requestFrom(
  checkpoint: DurableStandalonePlanningCheckpoint,
): StandalonePlanningRequest {
  const { workspaceId, projectId, requestedBy, requestId, idea } = checkpoint.input;
  return { workspaceId, projectId, requestedBy, requestId, idea };
}

function documentsFrom(
  checkpoint: DurableStandalonePlanningCheckpoint,
): PlanningDocumentView[] {
  const result: PlanningDocumentView[] = [];
  const versionViews = <T extends {
    version: number;
    versionId: string;
    normalizedContentHash: string;
  }>(versions: readonly T[]) =>
    versions.map((version, index) => ({
      version: version.version,
      versionId: version.versionId,
      hash: version.normalizedContentHash,
      structuredDiff:
        index === 0
          ? []
          : diffJson(
              JSON.parse(JSON.stringify(versions[index - 1])) as Parameters<
                typeof diffJson
              >[0],
              JSON.parse(JSON.stringify(version)) as Parameters<typeof diffJson>[0],
            ),
    }));
  if (checkpoint.projectSpec) {
    const history = checkpoint.projectSpecHistory ?? [checkpoint.projectSpec];
    result.push({
      subject: "project_spec",
      label: "产品规格",
      version: checkpoint.projectSpec.version,
      versionId: checkpoint.projectSpec.versionId,
      hash: checkpoint.projectSpec.normalizedContentHash,
      valid: checkpoint.aggregate.snapshot.projectSpec?.valid ?? false,
      approved: checkpoint.aggregate.effectiveApprovals.project_spec !== undefined,
      summary: summarizeProjectSpec(checkpoint.projectSpec),
      markdown: renderProjectSpecMarkdown(checkpoint.projectSpec),
      versions: versionViews(history),
    });
  }
  if (checkpoint.technicalDesign) {
    const history =
      checkpoint.technicalDesignHistory ?? [checkpoint.technicalDesign];
    result.push({
      subject: "technical_design",
      label: "技术设计",
      version: checkpoint.technicalDesign.version,
      versionId: checkpoint.technicalDesign.versionId,
      hash: checkpoint.technicalDesign.normalizedContentHash,
      valid: checkpoint.aggregate.snapshot.technicalDesign?.valid ?? false,
      approved:
        checkpoint.aggregate.effectiveApprovals.technical_design !== undefined,
      summary: summarizeTechnicalDesign(checkpoint.technicalDesign),
      markdown: renderTechnicalDesignMarkdown(checkpoint.technicalDesign),
      versions: versionViews(history),
    });
  }
  if (checkpoint.executionPlan) {
    const history = checkpoint.executionPlanHistory ?? [checkpoint.executionPlan];
    result.push({
      subject: "execution_plan",
      label: "执行计划",
      version: checkpoint.executionPlan.version,
      versionId: checkpoint.executionPlan.versionId,
      hash: checkpoint.executionPlan.normalizedContentHash,
      valid: checkpoint.aggregate.snapshot.executionPlan?.valid ?? false,
      approved:
        checkpoint.aggregate.effectiveApprovals.execution_plan !== undefined,
      summary: summarizeExecutionPlan(checkpoint.executionPlan),
      markdown: renderExecutionPlanMarkdown(checkpoint.executionPlan),
      versions: versionViews(history),
    });
  }
  return result;
}

function timelineFrom(checkpoint: DurableStandalonePlanningCheckpoint) {
  const snapshot = checkpoint.aggregate.snapshot;
  const ordered = [
    { stage: "discovery", label: "需求理解" },
    { stage: "product_spec", label: "产品规格" },
    { stage: "technical_design", label: "技术设计" },
    { stage: "execution_plan", label: "执行计划" },
  ] as const;
  const currentIndex = ordered.findIndex(({ stage }) => stage === snapshot.currentStage);
  return ordered.map((item, index) => ({
    ...item,
    state:
      snapshot.status === "ready_for_development" || index < currentIndex
        ? ("done" as const)
        : index === currentIndex
          ? ("active" as const)
          : ("pending" as const),
  }));
}

function viewFrom(
  checkpointRevision: number,
  checkpoint: DurableStandalonePlanningCheckpoint,
  actor: PlanningWebActor,
): PlanningPageViewModel {
  const status = checkpoint.aggregate.snapshot.status;
  const currentSubject = gateSubject[status];
  const currentDocument = documentsFrom(checkpoint).find(
    ({ subject }) => subject === currentSubject,
  );
  const editable = actor.role === "editor";
  return {
    workspaceId: checkpoint.input.workspaceId,
    projectId: checkpoint.input.projectId,
    idea: checkpoint.input.idea,
    status,
    statusLabel: statusLabels[status],
    checkpointRevision,
    snapshotRevision: checkpoint.aggregate.snapshot.revision,
    ...(currentSubject ? { currentSubject } : {}),
    ...(currentDocument
      ? {
          currentVersionId: currentDocument.versionId,
          currentHash: currentDocument.hash,
        }
      : {}),
    documents: documentsFrom(checkpoint),
    approvals: Object.keys(checkpoint.aggregate.effectiveApprovals).length,
    ...(checkpoint.discovery
      ? {
          discovery: {
            summary: checkpoint.discovery.understanding.summary,
            assumptions: checkpoint.discovery.understanding.assumptions.map(
              ({ statement }) => statement,
            ),
            risks: checkpoint.discovery.understanding.risks,
            questions: checkpoint.discovery.questions.map(({ question }) => question),
          },
        }
      : {}),
    timeline: timelineFrom(checkpoint),
    permissions: {
      canApprove: editable && currentSubject !== undefined,
      canRevise:
        editable &&
        (currentSubject !== undefined || status === "ready_for_development"),
      canCancel:
        editable && status === "awaiting_product_spec_approval",
    },
    ...(checkpoint.aggregate.developmentStart
      ? { developmentStart: checkpoint.aggregate.developmentStart }
      : {}),
  };
}

export interface PlanningWriteBinding {
  idempotencyKey: string;
  subject: PlanningSubject;
  versionId: string;
  hash: string;
}

export class PlanningWebController {
  public constructor(
    private readonly store: TransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>,
    private readonly ports: StandalonePlanningPorts = {
      ...createInMemoryStandalonePlanningPorts(),
      clock: new SystemClock(),
      ids: { nextId: (scope) => `${scope}:${randomUUID()}` },
    },
  ) {}

  public static fileBacked(directory: string): PlanningWebController {
    return new PlanningWebController(
      new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
        directory,
      ),
    );
  }

  public async get(
    workspaceId: string,
    projectId: string,
    actor: PlanningWebActor,
  ): Promise<PlanningPageViewModel> {
    assertWorkspace(actor, workspaceId);
    const stored = await this.store.load(checkpointKey(workspaceId, projectId));
    if (!stored) {
      throw new PlanningWebError("not_found", "Planning run not found");
    }
    return viewFrom(stored.revision, stored.value, actor);
  }

  public async start(
    request: StandalonePlanningRequest,
    actor: PlanningWebActor,
  ): Promise<PlanningPageViewModel> {
    assertWorkspace(actor, request.workspaceId);
    assertEditor(actor);
    if (request.requestedBy !== actor.actorId) {
      throw new PlanningWebError("forbidden", "Actor identity does not match");
    }
    await runDurableStandalonePlanning(
      request,
      this.ports,
      this.store,
      { pauseAtApprovalGates: true },
    );
    return this.get(request.workspaceId, request.projectId, actor);
  }

  public async approve(
    workspaceId: string,
    projectId: string,
    binding: PlanningWriteBinding,
    actor: PlanningWebActor,
  ): Promise<PlanningPageViewModel> {
    assertWorkspace(actor, workspaceId);
    assertEditor(actor);
    const stored = await this.store.load(checkpointKey(workspaceId, projectId));
    if (!stored) {
      throw new PlanningWebError("not_found", "Planning run not found");
    }
    if (stored.value.aggregate.processedCommands[binding.idempotencyKey]) {
      return viewFrom(stored.revision, stored.value, actor);
    }
    const expectedSubject = gateSubject[stored.value.aggregate.snapshot.status];
    const document = documentsFrom(stored.value).find(
      ({ subject }) => subject === expectedSubject,
    );
    if (
      !expectedSubject ||
      binding.subject !== expectedSubject ||
      document?.versionId !== binding.versionId ||
      document.hash !== binding.hash
    ) {
      throw new PlanningWebError("conflict", "Document binding is stale");
    }
    await runDurableStandalonePlanning(
      requestFrom(stored.value),
      this.ports,
      this.store,
      {
        pauseAtApprovalGates: true,
        approveStatus: stored.value.aggregate.snapshot.status as ApprovalGateStatus,
        approvalRequestId: binding.idempotencyKey,
      },
    );
    return this.get(workspaceId, projectId, actor);
  }

  public async revise(
    workspaceId: string,
    projectId: string,
    binding: PlanningWriteBinding & { feedback: string },
    actor: PlanningWebActor,
  ): Promise<PlanningPageViewModel> {
    assertWorkspace(actor, workspaceId);
    assertEditor(actor);
    const stored = await this.store.load(checkpointKey(workspaceId, projectId));
    if (!stored) {
      throw new PlanningWebError("not_found", "Planning run not found");
    }
    await returnDurablePlanningSubject(
      requestFrom(stored.value),
      {
        requestId: binding.idempotencyKey,
        actorId: actor.actorId,
        subjectType: binding.subject,
        subjectVersionId: binding.versionId,
        subjectHash: binding.hash,
        feedback: binding.feedback,
      },
      this.ports,
      this.store,
    );
    return this.get(workspaceId, projectId, actor);
  }

  public async cancel(
    workspaceId: string,
    projectId: string,
    binding: Omit<PlanningWriteBinding, "subject"> & { reason: string },
    actor: PlanningWebActor,
  ): Promise<PlanningPageViewModel> {
    assertWorkspace(actor, workspaceId);
    assertEditor(actor);
    const stored = await this.store.load(checkpointKey(workspaceId, projectId));
    if (!stored) {
      throw new PlanningWebError("not_found", "Planning run not found");
    }
    const outcome = await cancelDurablePlanning(
      requestFrom(stored.value),
      {
        requestId: binding.idempotencyKey,
        actorId: actor.actorId,
        subjectVersionId: binding.versionId,
        subjectHash: binding.hash,
        reason: binding.reason,
      },
      this.ports,
      this.store,
    );
    return viewFrom(outcome.checkpointRevision, outcome.checkpoint, actor);
  }
}

export function isPlanningWebError(error: unknown): error is PlanningWebError {
  return error instanceof PlanningWebError || error instanceof StandalonePlanningError;
}
