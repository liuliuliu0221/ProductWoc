import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  agentRunSchema,
  completeTaskCommandSchema,
  developmentInvalidationRecordSchema,
  developmentContractManifestSchema,
  developmentInputSnapshotSchema,
  developmentEvidenceTypeSchema,
  developmentRunSchema,
  developmentCommandReceiptSchema,
  developmentControlCommandSchema,
  developmentOutboxEventSchema,
  developmentPendingOperationSchema,
  developmentRecoveryAuditSchema,
  modelPolicySchema,
  modelRunSnapshotSchema,
  changeProposalSchema,
  patchJournalEntrySchema,
  patchTransactionResultSchema,
  phaseGateDecisionSchema,
  phaseRunSchema,
  taskRunSchema,
  taskContextSnapshotSchema,
  structuredCommandTemplateSchema,
  toolEventSchema,
  verificationEvidenceSchema,
  verificationErrorCategorySchema,
  workspacePatchRequestSchema,
  workspacePolicySchema,
} from "../src/index.js";
import {
  developmentContractManifest,
  developmentWorkflowDefinitionIdentity,
} from "../src/manifest.js";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8"),
  );
}

describe("development v1 contracts", () => {
  it("keeps the checked-in manifest valid and bound to its definition", () => {
    expect(
      developmentContractManifestSchema.parse(developmentContractManifest),
    ).toEqual(developmentContractManifest);
    expect(developmentContractManifest.definitionChecksum).toBe(
      createHash("sha256")
        .update(JSON.stringify(developmentWorkflowDefinitionIdentity))
        .digest("hex"),
    );
  });

  it("accepts the checked-in DevelopmentInputSnapshot fixture", () => {
    expect(
      developmentInputSnapshotSchema.safeParse(
        loadFixture("development-input-snapshot-valid-v1.json"),
      ).success,
    ).toBe(true);
  });

  it("rejects a snapshot with an invalid task graph hash", () => {
    expect(
      developmentInputSnapshotSchema.safeParse(
        loadFixture("development-input-snapshot-invalid-v1.json"),
      ).success,
    ).toBe(false);
  });

  it("supports one default model plus optional stage overrides for every user", () => {
    expect(
      modelPolicySchema.safeParse({
        policyId: "model-policy-1",
        profiles: [
          {
            profileId: "local-default",
            providerType: "deterministic",
            model: "fixture-v1",
            temperature: 0,
            maxOutputTokens: 4096,
            capabilities: {
              structuredOutput: true,
              toolCalling: false,
              vision: false,
              localOnly: true,
            },
          },
        ],
        applicationDefaultProfileId: "local-default",
        projectDefaultProfileId: "local-default",
        stageOverrides: [
          {
            scope: "development.review",
            profileId: "local-default",
          },
        ],
        fallback: "pause",
        createdAt: "2026-08-28T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown privilege or subscription fields", () => {
    expect(
      modelPolicySchema.safeParse({
        policyId: "model-policy-1",
        profiles: [
          {
            profileId: "local-default",
            providerType: "deterministic",
            model: "fixture-v1",
            temperature: 0,
            maxOutputTokens: 4096,
            capabilities: {
              structuredOutput: true,
              toolCalling: false,
              vision: false,
              localOnly: true,
            },
          },
        ],
        applicationDefaultProfileId: "local-default",
        stageOverrides: [],
        fallback: "pause",
        userTier: "advanced",
        createdAt: "2026-08-28T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate stage overrides", () => {
    expect(
      modelPolicySchema.safeParse({
        policyId: "model-policy-1",
        profiles: [
          {
            profileId: "local-default",
            providerType: "deterministic",
            model: "fixture-v1",
            temperature: 0,
            maxOutputTokens: 4096,
            capabilities: {
              structuredOutput: true,
              toolCalling: false,
              vision: false,
              localOnly: true,
            },
          },
        ],
        applicationDefaultProfileId: "local-default",
        stageOverrides: [
          {
            scope: "development.review",
            profileId: "local-default",
          },
          {
            scope: "development.review",
            profileId: "local-default",
          },
        ],
        fallback: "pause",
        createdAt: "2026-08-28T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("keeps ModelRunSnapshot free of credential values", () => {
    const parsed = modelRunSnapshotSchema.parse({
      snapshotId: "model-snapshot-1",
      routeRequestId: "route-request-1",
      agentRunId: "agent-run-1",
      policyId: "model-policy-1",
      scope: "development.implementation",
      selectionSource: "project_default",
      profile: {
        profileId: "remote-default",
        providerType: "openai_compatible",
        model: "compatible-model",
        endpointRef: "endpoint-local-1",
        credentialRef: "credential-local-1",
        temperature: 0,
        maxOutputTokens: 4096,
        capabilities: {
          structuredOutput: true,
          toolCalling: true,
          vision: false,
          localOnly: false,
        },
      },
      policyHash: "1111111111111111111111111111111111111111111111111111111111111111",
      profileHash: "2222222222222222222222222222222222222222222222222222222222222222",
      configurationHash: "3333333333333333333333333333333333333333333333333333333333333333",
      promptVersion: "1.0.0",
      toolPolicyVersion: "1.0.0",
      contextHash: "4444444444444444444444444444444444444444444444444444444444444444",
      createdAt: "2026-08-28T00:00:00.000Z",
    });

    expect(JSON.stringify(parsed)).toContain("credential-local-1");
    expect(JSON.stringify(parsed)).not.toContain("secret-value");
  });

  it("validates the P3-02 Run hierarchy and evidence binding", () => {
    const input = developmentInputSnapshotSchema.parse(
      loadFixture("development-input-snapshot-valid-v1.json"),
    );
    expect(
      developmentRunSchema.safeParse({
        developmentRunId: input.developmentRunId,
        input,
        status: "running",
        revision: 1,
        currentPhaseRunId: "phase-run-1",
        currentTaskRunId: "task-run-1",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).success,
    ).toBe(true);
    expect(
      phaseRunSchema.safeParse({
        phaseRunId: "phase-run-1",
        developmentRunId: input.developmentRunId,
        executionPhaseId: "phase-1",
        taskRunIds: ["task-run-1"],
        status: "running",
        revision: 1,
        startedAt: input.createdAt,
      }).success,
    ).toBe(true);
    expect(
      taskRunSchema.safeParse({
        taskRunId: "task-run-1",
        developmentRunId: input.developmentRunId,
        executionTaskId: "task-1",
        taskDefinitionHash: "1".repeat(64),
        status: "verifying",
        revision: 4,
        modelSnapshotId: "model-snapshot-1",
        agentRunIds: ["agent-run-1"],
        evidenceIds: [],
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).success,
    ).toBe(true);
    expect(
      agentRunSchema.safeParse({
        agentRunId: "agent-run-1",
        developmentRunId: input.developmentRunId,
        taskRunId: "task-run-1",
        purpose: "implementation",
        modelSnapshotId: "model-snapshot-1",
        status: "running",
        createdAt: input.createdAt,
      }).success,
    ).toBe(true);
    const evidence = verificationEvidenceSchema.parse({
      evidenceId: "evidence-1",
      developmentRunId: input.developmentRunId,
      taskRunId: "task-run-1",
      verificationStepId: "verify-1",
      taskDefinitionHash: "1".repeat(64),
      modelSnapshotId: "model-snapshot-1",
      type: "test_report",
      producer: "verification_runner",
      artifactId: "artifact-1",
      artifactHash: "2".repeat(64),
      patchJournalEntryId: "journal-1",
      commandResultHash: "4".repeat(64),
      exitCode: 0,
      errorCategory: "none",
      summary: "Verification passed",
      workspaceHash: "3".repeat(64),
      outcome: "passed",
      producedAt: input.createdAt,
    });
    expect(
      completeTaskCommandSchema.safeParse({
        requestId: "complete-1",
        taskRunId: "task-run-1",
        evidenceIds: [evidence.evidenceId],
        completedAt: input.createdAt,
      }).success,
    ).toBe(true);
  });

  it("keeps gate decisions human-only and invalidation records appendable", () => {
    const decision = {
      decisionId: "decision-1",
      requestId: "confirm-gate-1",
      developmentRunId: "development-run-1",
      phaseRunId: "phase-run-1",
      userGateId: "user-gate-1",
      actorType: "user",
      actorId: "user-1",
      confirmedAt: "2026-08-29T00:00:00.000Z",
    } as const;
    expect(phaseGateDecisionSchema.safeParse(decision).success).toBe(true);
    expect(
      phaseGateDecisionSchema.safeParse({
        ...decision,
        actorType: "model",
      }).success,
    ).toBe(false);
    expect(
      developmentInvalidationRecordSchema.safeParse({
        invalidationId: "invalidate-1",
        causedByRequestId: "revision-1",
        developmentRunId: "development-run-1",
        kind: "planning_revision",
        targetType: "task",
        targetId: "task-run-1",
        reason: "Technical Design changed",
        invalidatedAt: "2026-08-29T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("validates fail-closed Workspace and Patch policy contracts", () => {
    expect(
      workspacePolicySchema.safeParse({
        policyVersion: "1.0.0",
        ignoredPathSegments: [".git", "node_modules"],
        sensitivePathPatterns: [".env*", ".ssh/**"],
        maxFileSizeBytes: 1_000_000,
        maxFiles: 20_000,
        followSymlinks: false,
      }).success,
    ).toBe(true);
    expect(
      workspacePolicySchema.safeParse({
        policyVersion: "1.0.0",
        ignoredPathSegments: [],
        sensitivePathPatterns: [".env*"],
        maxFileSizeBytes: 1_000_000,
        maxFiles: 20_000,
        followSymlinks: true,
      }).success,
    ).toBe(false);
    expect(
      workspacePatchRequestSchema.safeParse({
        requestId: "delete-1",
        relativePath: "src/index.ts",
        operation: "delete",
        confirmationId: "confirmation-1",
      }).success,
    ).toBe(false);
  });

  it("validates immutable P3-04 Context, Proposal and Patch Journal contracts", () => {
    const context = taskContextSnapshotSchema.parse({
      contextSnapshotId: "context-1",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      agentRunId: "agent-run-1",
      executionTaskId: "task-1",
      taskDefinitionHash: "1".repeat(64),
      projectSpecVersionId: "spec-1",
      technicalDesignVersionId: "design-1",
      executionPlanVersionId: "plan-1",
      allowedWritePaths: ["src/**"],
      blocks: [
        {
          blockId: "block-1",
          kind: "requirement",
          sourceId: "REQ-1",
          sourceHash: "2".repeat(64),
          content: "Requirement content",
          trust: "untrusted_reference",
          instructionAuthority: "none",
          inclusionReason: "Current Task requirement",
          redacted: false,
          truncated: false,
        },
      ],
      sources: [
        {
          sourceId: "REQ-1",
          sourceHash: "2".repeat(64),
          kind: "requirement",
          includedBlockIds: ["block-1"],
          redacted: false,
          truncated: false,
        },
      ],
      excludedCategories: ["full_chat_history", "sensitive_files"],
      contextHash: "3".repeat(64),
      createdAt: "2026-08-29T00:00:00.000Z",
    });
    const proposal = changeProposalSchema.parse({
      proposalId: "proposal-1",
      developmentRunId: context.developmentRunId,
      taskRunId: context.taskRunId,
      agentRunId: context.agentRunId,
      contextSnapshotId: context.contextSnapshotId,
      contextHash: context.contextHash,
      modelSnapshotId: "model-snapshot-1",
      summary: "Create the approved file",
      operations: [
        {
          operation: "create",
          relativePath: "src/created.ts",
          content: "export {};\n",
          rationale: "Implement the requirement",
          requirementIds: ["REQ-1"],
          designItemIds: ["DES-1"],
        },
      ],
      dependencyChanges: [],
      riskNotes: [],
      generatedAt: "2026-08-29T00:00:00.000Z",
    });
    const journal = patchJournalEntrySchema.parse({
      journalEntryId: "journal-1",
      patchSetId: "patch-set-1",
      proposalId: proposal.proposalId,
      proposalHash: "4".repeat(64),
      idempotencyKey: "patch-key-1",
      developmentRunId: proposal.developmentRunId,
      taskRunId: proposal.taskRunId,
      agentRunId: proposal.agentRunId,
      contextSnapshotId: proposal.contextSnapshotId,
      modelSnapshotId: proposal.modelSnapshotId,
      status: "applied",
      operations: [
        {
          operation: "create",
          relativePath: "src/created.ts",
          afterHash: "5".repeat(64),
          rollback: {
            operation: "delete",
            relativePath: "src/created.ts",
            expectedBeforeHash: "5".repeat(64),
          },
          requirementIds: ["REQ-1"],
          designItemIds: ["DES-1"],
        },
      ],
      workspaceManifestBeforeHash: "6".repeat(64),
      workspaceManifestAfterHash: "7".repeat(64),
      diffHash: "8".repeat(64),
      toolPolicyVersion: "1.0.0",
      rollbackAvailable: true,
      appliedAt: "2026-08-29T00:00:00.000Z",
    });
    expect(
      patchTransactionResultSchema.safeParse({
        applied: true,
        reason: "applied",
        patchSetId: journal.patchSetId,
        journalEntry: journal,
      }).success,
    ).toBe(true);
  });

  it("rejects structurally ambiguous create and delete Proposal operations", () => {
    const base = {
      rationale: "Fixture operation",
      requirementIds: ["REQ-1"],
      designItemIds: ["DES-1"],
    };
    const proposal = {
      proposalId: "proposal-invalid",
      developmentRunId: "development-run-1",
      taskRunId: "task-run-1",
      agentRunId: "agent-run-1",
      contextSnapshotId: "context-1",
      contextHash: "1".repeat(64),
      modelSnapshotId: "model-1",
      summary: "Invalid mixed operations",
      operations: [
        {
          ...base,
          operation: "create",
          relativePath: "src/create.ts",
          beforeHash: "2".repeat(64),
          content: "create",
        },
        {
          ...base,
          operation: "delete",
          relativePath: "src/delete.ts",
          beforeHash: "3".repeat(64),
          content: "unexpected replacement",
        },
      ],
      dependencyChanges: [],
      riskNotes: [],
      generatedAt: "2026-08-29T00:00:00.000Z",
    };
    expect(changeProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it("accepts passing and failed P3-05 fixtures for every Evidence class", () => {
    const fixture = loadFixture("verification-evidence-types-v1.json") as {
      evidenceTypes: string[];
      failureCategories: string[];
    };
    for (const [index, type] of fixture.evidenceTypes.entries()) {
      const base = {
        developmentRunId: "development-run-1",
        taskRunId: "task-run-1",
        verificationStepId: `verify-${index}`,
        taskDefinitionHash: "1".repeat(64),
        modelSnapshotId: "model-1",
        type,
        producer: "verification_runner",
        artifactId: `artifact-${index}`,
        artifactHash: "2".repeat(64),
        patchJournalEntryId: "journal-1",
        commandResultHash: "3".repeat(64),
        workspaceHash: "4".repeat(64),
        summary: "Fixture Evidence",
        producedAt: "2026-08-29T00:00:00.000Z",
      };
      expect(
        verificationEvidenceSchema.safeParse({
          ...base,
          evidenceId: `evidence-pass-${index}`,
          exitCode: 0,
          errorCategory: "none",
          outcome: "passed",
        }).success,
      ).toBe(true);
      expect(
        verificationEvidenceSchema.safeParse({
          ...base,
          evidenceId: `evidence-fail-${index}`,
          exitCode: 1,
          errorCategory: "verification_failed",
          outcome: "failed",
        }).success,
      ).toBe(true);
    }
    expect(fixture.evidenceTypes).toEqual(developmentEvidenceTypeSchema.options);
    expect(fixture.failureCategories).toEqual(
      verificationErrorCategorySchema.options.filter((value) => value !== "none"),
    );
  });

  it("rejects a false passing result with a non-zero Exit Code", () => {
    expect(
      verificationEvidenceSchema.safeParse({
        evidenceId: "false-positive-evidence",
        developmentRunId: "development-run-1",
        taskRunId: "task-run-1",
        verificationStepId: "verify-test",
        taskDefinitionHash: "1".repeat(64),
        modelSnapshotId: "model-1",
        type: "test_report",
        producer: "verification_runner",
        artifactId: "artifact-false-positive",
        artifactHash: "2".repeat(64),
        patchJournalEntryId: "journal-1",
        commandResultHash: "3".repeat(64),
        exitCode: 1,
        errorCategory: "none",
        summary: "Agent claims completion",
        workspaceHash: "4".repeat(64),
        outcome: "passed",
        producedAt: "2026-08-29T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects Shell control characters and unredacted Tool Events", () => {
    expect(
      structuredCommandTemplateSchema.safeParse({
        templateId: "injected-test",
        kind: "test",
        executable: "pnpm",
        args: ["test;curl", "example.invalid"],
        timeoutMs: 60_000,
      }).success,
    ).toBe(false);
    expect(
      toolEventSchema.safeParse({
        eventId: "event-1",
        requestId: "request-1",
        decisionId: "decision-1",
        operation: "command",
        disposition: "denied",
        redactedArguments: ["token-secret-value-12345678"],
        resultSummary: "denied",
        occurredAt: "2026-08-29T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      toolEventSchema.safeParse({
        eventId: "event-2",
        requestId: "request-2",
        decisionId: "decision-2",
        operation: "command",
        disposition: "denied",
        redactedArguments: ["<workspace>"],
        resultSummary: "password=hunter2",
        occurredAt: "2026-08-29T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("defines strict durable command, Outbox and recovery records", () => {
    expect(
      developmentControlCommandSchema.safeParse({
        requestId: "pause-1",
        action: "pause",
        actorId: "local-user",
        reason: "Pause at a safe boundary",
        occurredAt: "2026-08-29T16:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      developmentCommandReceiptSchema.safeParse({
        requestId: "pause-1",
        commandKind: "pause",
        status: "committed",
        aggregateRevision: 3,
        resultHash: "1".repeat(64),
        recordedAt: "2026-08-29T16:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      developmentOutboxEventSchema.safeParse({
        eventId: "event-1",
        developmentRunId: "development-run-1",
        sequence: 1,
        requestId: "pause-1",
        commandKind: "pause",
        eventType: "development.state_changed",
        aggregateRevision: 3,
        payload: { status: "paused" },
        payloadHash: "2".repeat(64),
        occurredAt: "2026-08-29T16:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      developmentRecoveryAuditSchema.safeParse({
        auditId: "audit-1",
        developmentRunId: "development-run-1",
        checkpointRevision: 4,
        reason: "verification_interrupted",
        disposition: "resume_verification",
        envelopeHash: "3".repeat(64),
        expectedWorkspaceHash: "4".repeat(64),
        actualWorkspaceHash: "4".repeat(64),
        auditedAt: "2026-08-29T16:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an under-specified pending Patch operation", () => {
    expect(
      developmentPendingOperationSchema.safeParse({
        requestId: "apply-1",
        commandKind: "apply",
        taskRunId: "task-run-1",
        operation: "applying_patch",
        beforeWorkspaceHash: "1".repeat(64),
        startedAt: "2026-08-29T16:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
