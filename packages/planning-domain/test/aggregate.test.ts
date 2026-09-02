import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  developmentStartEnvelopeSchema,
  executionPlanContentSchema,
  executionPlanVersionSchema,
  planningContractManifest,
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
  type ApprovePlanningSubjectCommand,
  type PlanningSnapshotV2,
  type PlanningSubject,
  type RecordDocumentVersionCommand,
} from "@product-woc/planning-contracts";

import {
  approvePlanningSubject,
  createPlanningAggregate,
  recordDocumentVersion,
  recordExecutionPlanVersion,
  recordTechnicalDesignVersion,
  rejectProjectSpec,
  returnToPlanningSubject,
  validateDevelopmentStartEnvelope,
  type PlanningAggregate,
} from "../src/index.js";

const hashes: Record<PlanningSubject, string> = {
  project_spec: "a".repeat(64),
  technical_design: "b".repeat(64),
  execution_plan: "c".repeat(64),
};

const technicalFixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const technicalContent = technicalDesignContentSchema.parse(
  JSON.parse(readFileSync(technicalFixtureUrl, "utf8")),
);
const executionFixtureUrl = new URL(
  "../../../fixtures/execution-plan-valid-v1.json",
  import.meta.url,
);
const executionContent = executionPlanContentSchema.parse(
  JSON.parse(readFileSync(executionFixtureUrl, "utf8")),
);

const versionIds: Record<PlanningSubject, string> = {
  project_spec: "spec-1",
  technical_design: "design-1",
  execution_plan: "plan-1",
};

const stageRunIds: Record<PlanningSubject, string> = {
  project_spec: "stage-spec-1",
  technical_design: "stage-design-1",
  execution_plan: "stage-plan-1",
};

const initialSnapshot: PlanningSnapshotV2 = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  workflowRunId: "workflow-run-1",
  currentStage: "product_spec",
  status: "generating_product_spec",
  revision: 0,
  updatedAt: "2026-08-27T08:00:00+08:00",
};

function newAggregate(): PlanningAggregate {
  return createPlanningAggregate(initialSnapshot, {
    approvalPolicyVersion: planningContractManifest.approvalPolicyVersion,
    workflowDefinitionVersion: planningContractManifest.workflowVersion,
    workflowDefinitionChecksum: planningContractManifest.definitionChecksum,
    validationPolicyVersion: "2.0.0",
  });
}

function recordCommand(
  subjectType: PlanningSubject,
  overrides: Partial<RecordDocumentVersionCommand> = {},
): RecordDocumentVersionCommand {
  return {
    requestId: `record-${subjectType}-1`,
    subjectType,
    versionId: versionIds[subjectType],
    version: 1,
    subjectHash: hashes[subjectType],
    recordedAt: "2026-08-27T08:01:00+08:00",
    ...overrides,
  };
}

function approvalCommand(
  subjectType: PlanningSubject,
  overrides: Partial<ApprovePlanningSubjectCommand> = {},
): ApprovePlanningSubjectCommand {
  return {
    requestId: `approve-${subjectType}-1`,
    approvalId: `approval-${subjectType}-1`,
    actorId: "user-1",
    stageRunId: stageRunIds[subjectType],
    subjectType,
    subjectVersionId: versionIds[subjectType],
    subjectHash: hashes[subjectType],
    approvalPolicyVersion: "2.0.0",
    approvedAt: "2026-08-27T08:02:00+08:00",
    ...overrides,
  };
}

function completeThroughPlanCandidate(): PlanningAggregate {
  let state = newAggregate();
  state = recordDocumentVersion(state, recordCommand("project_spec")).state;
  state = approvePlanningSubject(state, approvalCommand("project_spec")).state;
  state = recordDocumentVersion(state, recordCommand("technical_design")).state;
  state = approvePlanningSubject(state, approvalCommand("technical_design")).state;
  state = recordDocumentVersion(state, recordCommand("execution_plan")).state;
  return state;
}

describe("planning aggregate", () => {
  it("creates exactly one version-fixed development start", () => {
    const awaitingPlanApproval = completeThroughPlanCandidate();
    const command = approvalCommand("execution_plan");
    const completed = approvePlanningSubject(awaitingPlanApproval, command);

    expect(completed.result).toMatchObject({
      accepted: true,
      reason: "accepted",
      status: "ready_for_development",
    });
    expect(completed.state.snapshot.status).toBe("ready_for_development");
    expect(completed.state.approvalHistory).toHaveLength(3);
    expect(completed.state.developmentStart).toMatchObject({
      projectSpecVersionId: "spec-1",
      technicalDesignVersionId: "design-1",
      executionPlanVersionId: "plan-1",
      approvalIds: [
        "approval-project_spec-1",
        "approval-technical_design-1",
        "approval-execution_plan-1",
      ],
    });
    expect(() =>
      developmentStartEnvelopeSchema.parse(completed.state.developmentStart),
    ).not.toThrow();
    expect(
      validateDevelopmentStartEnvelope(
        completed.state,
        completed.state.developmentStart!,
      ),
    ).toEqual({ valid: true, issues: [] });

    expect(
      validateDevelopmentStartEnvelope(completed.state, {
        ...completed.state.developmentStart!,
        technicalDesignHash: "f".repeat(64),
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["document_binding_mismatch"]),
    });

    const repeated = approvePlanningSubject(completed.state, command);
    expect(repeated.state).toBe(completed.state);
    expect(repeated.result).toEqual(completed.result);

    const secondRequest = approvePlanningSubject(
      completed.state,
      approvalCommand("execution_plan", {
        requestId: "approve-execution-plan-again",
        approvalId: "approval-execution-plan-again",
      }),
    );
    expect(secondRequest.result.reason).toBe("duplicate");
    expect(secondRequest.state.developmentStart).toEqual(
      completed.state.developmentStart,
    );
    expect(secondRequest.state.approvalHistory).toHaveLength(3);
  });

  it("rejects an approval whose immutable hash does not match", () => {
    const awaitingSpecApproval = recordDocumentVersion(
      newAggregate(),
      recordCommand("project_spec"),
    ).state;
    const execution = approvePlanningSubject(
      awaitingSpecApproval,
      approvalCommand("project_spec", { subjectHash: "f".repeat(64) }),
    );

    expect(execution.result).toMatchObject({
      accepted: false,
      reason: "subject_mismatch",
      status: "awaiting_product_spec_approval",
    });
    expect(execution.state.approvalHistory).toHaveLength(0);
  });

  it("keeps history but invalidates every downstream pointer and approval", () => {
    const awaitingPlanApproval = completeThroughPlanCandidate();
    const returned = returnToPlanningSubject(awaitingPlanApproval, {
      requestId: "return-to-spec-1",
      actorId: "user-1",
      subjectType: "project_spec",
      feedback: "Change the MVP scope",
      returnedAt: "2026-08-27T09:00:00+08:00",
    });
    expect(returned.result.accepted).toBe(true);

    const revised = recordDocumentVersion(
      returned.state,
      recordCommand("project_spec", {
        requestId: "record-project-spec-2",
        versionId: "spec-2",
        version: 2,
        subjectHash: "d".repeat(64),
        recordedAt: "2026-08-27T09:01:00+08:00",
      }),
    );

    expect(revised.state.snapshot.projectSpec).toMatchObject({
      versionId: "spec-2",
      valid: true,
    });
    expect(revised.state.snapshot.technicalDesign?.valid).toBe(false);
    expect(revised.state.snapshot.executionPlan?.valid).toBe(false);
    expect(revised.state.effectiveApprovals).toEqual({});
    expect(revised.state.approvalHistory).toHaveLength(2);
    expect(
      revised.state.invalidations.map((record) => record.invalidatedSubjectType),
    ).toEqual(["project_spec", "technical_design", "execution_plan"]);
    expect(revised.state.developmentStart).toBeUndefined();
  });

  it("invalidates an old DevelopmentStartEnvelope after an upstream revision", () => {
    const completed = approvePlanningSubject(
      completeThroughPlanCandidate(),
      approvalCommand("execution_plan"),
    ).state;
    const oldEnvelope = completed.developmentStart!;
    const revised: PlanningAggregate = {
      ...completed,
      snapshot: {
        ...completed.snapshot,
        status: "generating_product_spec",
        currentStage: "product_spec",
        projectSpec: {
          versionId: "spec-2",
          version: 2,
          hash: "d".repeat(64),
          valid: true,
        },
        technicalDesign: { ...completed.snapshot.technicalDesign!, valid: false },
        executionPlan: { ...completed.snapshot.executionPlan!, valid: false },
      },
      effectiveApprovals: {},
    };
    delete revised.developmentStart;

    expect(revised.developmentStart).toBeUndefined();
    expect(
      validateDevelopmentStartEnvelope(revised, oldEnvelope),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        "workflow_not_ready",
        "document_binding_mismatch",
        "approval_binding_mismatch",
      ]),
    });
  });

  it("reopens a completed run and invalidates all downstream authority", () => {
    const completed = approvePlanningSubject(
      completeThroughPlanCandidate(),
      approvalCommand("execution_plan"),
    ).state;
    const oldEnvelope = completed.developmentStart!;
    const returned = returnToPlanningSubject(completed, {
      requestId: "reopen-ready-project-spec",
      actorId: "user-1",
      subjectType: "project_spec",
      feedback: "Change the completed MVP boundary",
      returnedAt: "2026-08-27T10:00:00+08:00",
    });
    const revised = recordDocumentVersion(
      returned.state,
      recordCommand("project_spec", {
        requestId: "record-ready-project-spec-2",
        versionId: "spec-ready-2",
        version: 2,
        subjectHash: "e".repeat(64),
        recordedAt: "2026-08-27T10:01:00+08:00",
      }),
    );

    expect(returned.result).toMatchObject({
      accepted: true,
      status: "generating_product_spec",
    });
    expect(revised.state).toMatchObject({
      snapshot: {
        status: "awaiting_product_spec_approval",
        technicalDesign: { valid: false },
        executionPlan: { valid: false },
      },
      effectiveApprovals: {},
    });
    expect(revised.state.developmentStart).toBeUndefined();
    expect(validateDevelopmentStartEnvelope(revised.state, oldEnvelope).valid).toBe(
      false,
    );
    expect(revised.state.invalidations.slice(-3).map(({ reason }) => reason)).toEqual([
      "subject_content_changed",
      "upstream_content_changed",
      "upstream_content_changed",
    ]);
    expect(completed.snapshot.status).toBe("ready_for_development");
    expect(completed.developmentStart).toEqual(oldEnvelope);
    expect(completed.invalidations).toEqual([]);
    expect(completed.approvalHistory).toHaveLength(3);
  });

  it("requires monotonically increasing document versions", () => {
    const awaitingSpecApproval = recordDocumentVersion(
      newAggregate(),
      recordCommand("project_spec"),
    ).state;
    const returned = returnToPlanningSubject(awaitingSpecApproval, {
      requestId: "revise-spec-1",
      actorId: "user-1",
      subjectType: "project_spec",
      feedback: "Revise the scope",
      returnedAt: "2026-08-27T09:00:00+08:00",
    });
    const stale = recordDocumentVersion(
      returned.state,
      recordCommand("project_spec", {
        requestId: "record-stale-spec",
        versionId: "spec-stale",
        subjectHash: "e".repeat(64),
      }),
    );

    expect(stale.result).toMatchObject({
      accepted: false,
      reason: "version_not_monotonic",
    });
    expect(stale.state.snapshot.projectSpec?.versionId).toBe("spec-1");
  });

  it("rejects a pending Project Spec idempotently", () => {
    const awaitingSpecApproval = recordDocumentVersion(
      newAggregate(),
      recordCommand("project_spec"),
    ).state;
    const command = {
      requestId: "reject-spec-1",
      actorId: "user-1",
      reason: "The proposed product is no longer needed",
      rejectedAt: "2026-08-28T00:10:00+08:00",
    };
    const rejected = rejectProjectSpec(awaitingSpecApproval, command);
    const repeated = rejectProjectSpec(rejected.state, command);

    expect(rejected.result).toMatchObject({ accepted: true, status: "cancelled" });
    expect(repeated.state).toBe(rejected.state);
    expect(repeated.result).toEqual(rejected.result);
  });

  it("rejects a Technical Design bound to an old Project Spec hash", () => {
    let state = recordDocumentVersion(
      newAggregate(),
      recordCommand("project_spec"),
    ).state;
    state = approvePlanningSubject(state, approvalCommand("project_spec")).state;
    const version = technicalDesignVersionSchema.parse({
      ...technicalContent,
      versionId: "design-old-binding",
      version: 1,
      normalizedContentHash: "b".repeat(64),
      schemaVersion: "2.0.0",
      createdAt: "2026-08-28T00:20:00+08:00",
      projectSpecVersionId: "spec-1",
      projectSpecHash: "f".repeat(64),
      sourceArtifactIds: [],
      promptVersion: "1.0.0",
      modelSnapshot: "fixture-architect",
    });
    const execution = recordTechnicalDesignVersion(
      state,
      "record-old-bound-design",
      version,
      "2026-08-28T00:21:00+08:00",
    );

    expect(execution.result).toMatchObject({
      accepted: false,
      reason: "upstream_binding_mismatch",
    });
    expect(execution.state.snapshot.technicalDesign).toBeUndefined();
  });

  it("rejects an Execution Plan bound to an old Technical Design hash", () => {
    let state = recordDocumentVersion(
      newAggregate(),
      recordCommand("project_spec"),
    ).state;
    state = approvePlanningSubject(state, approvalCommand("project_spec")).state;
    state = recordDocumentVersion(
      state,
      recordCommand("technical_design"),
    ).state;
    state = approvePlanningSubject(state, approvalCommand("technical_design")).state;
    const version = executionPlanVersionSchema.parse({
      ...executionContent,
      versionId: "plan-old-binding",
      version: 1,
      normalizedContentHash: "c".repeat(64),
      schemaVersion: "2.0.0",
      createdAt: "2026-08-28T00:22:00+08:00",
      projectSpecVersionId: "spec-1",
      projectSpecHash: "a".repeat(64),
      technicalDesignVersionId: "design-1",
      technicalDesignHash: "f".repeat(64),
      sourceArtifactIds: [],
      promptVersion: "1.0.0",
      modelSnapshot: "fixture-planner",
    });
    const execution = recordExecutionPlanVersion(
      state,
      "record-old-bound-plan",
      version,
      "2026-08-28T00:23:00+08:00",
    );

    expect(execution.result).toMatchObject({
      accepted: false,
      reason: "upstream_binding_mismatch",
    });
    expect(execution.state.snapshot.executionPlan).toBeUndefined();
  });
});
