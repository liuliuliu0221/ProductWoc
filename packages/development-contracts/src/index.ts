import { z } from "zod";

export const DEVELOPMENT_WORKFLOW_KEY = "product-woc-development";
export const DEVELOPMENT_WORKFLOW_VERSION = "1.0.0";
export const DEVELOPMENT_CONTRACT_VERSION = "1.0.0";
export const DEVELOPMENT_INPUT_SCHEMA_VERSION = "1.0.0";
export const DEVELOPMENT_EVENT_SCHEMA_VERSION = "1.0.0";
export const DEVELOPMENT_VALIDATION_POLICY_VERSION = "1.0.0";
export const DEVELOPMENT_TOOL_POLICY_VERSION = "1.0.0";

export const developmentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const developmentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const developmentSemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const developmentRunStatusSchema = z.enum([
  "validating_input",
  "ready",
  "running",
  "awaiting_user_gate",
  "paused",
  "needs_user_action",
  "stale",
  "completed",
  "failed",
  "cancelled",
]);

export const taskRunStatusSchema = z.enum([
  "pending",
  "ready",
  "assembling_context",
  "generating_change",
  "awaiting_patch_approval",
  "applying_patch",
  "verifying",
  "repairing",
  "completed",
  "blocked",
  "failed",
  "rolled_back",
  "cancelled",
  "stale",
]);

export const phaseRunStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "awaiting_gate",
  "completed",
  "blocked",
  "stale",
  "cancelled",
]);

export const agentRunStatusSchema = z.enum([
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
  "stale",
]);

export const modelStageScopeSchema = z.enum([
  "planning.discovery",
  "planning.project_spec",
  "planning.technical_design",
  "planning.execution_plan",
  "development.implementation",
  "development.review",
  "development.repair",
]);

export const modelProfileSchema = z
  .object({
    profileId: developmentIdSchema,
    providerType: z.enum(["deterministic", "ollama", "openai_compatible"]),
    model: z.string().trim().min(1).max(240),
    endpointRef: developmentIdSchema.optional(),
    credentialRef: developmentIdSchema.optional(),
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().positive(),
    contextWindow: z.number().int().positive().optional(),
    capabilities: z
      .object({
        structuredOutput: z.boolean(),
        toolCalling: z.boolean(),
        vision: z.boolean(),
        localOnly: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.providerType !== "deterministic" && !value.endpointRef) {
      context.addIssue({
        code: "custom",
        path: ["endpointRef"],
        message: "A network-compatible provider requires an Endpoint Ref",
      });
    }
    if (value.providerType === "deterministic" && !value.capabilities.localOnly) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", "localOnly"],
        message: "The deterministic provider must remain local-only",
      });
    }
  });

export const stageModelOverrideSchema = z
  .object({
    scope: modelStageScopeSchema,
    profileId: developmentIdSchema,
  })
  .strict();

export const modelCapabilityRequirementSchema = z
  .object({
    structuredOutput: z.boolean(),
    toolCalling: z.boolean(),
    vision: z.boolean(),
    localOnly: z.boolean(),
    minimumContextWindow: z.number().int().positive(),
  })
  .strict();

export const modelPolicySchema = z
  .object({
    policyId: developmentIdSchema,
    profiles: z.array(modelProfileSchema).min(1),
    applicationDefaultProfileId: developmentIdSchema,
    projectDefaultProfileId: developmentIdSchema.optional(),
    stageOverrides: z.array(stageModelOverrideSchema),
    fallback: z.enum(["pause", "explicit_profile"]),
    fallbackProfileId: developmentIdSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const profileIds = new Set(value.profiles.map((profile) => profile.profileId));
    if (profileIds.size !== value.profiles.length) {
      context.addIssue({
        code: "custom",
        path: ["profiles"],
        message: "Model Profile IDs must be unique",
      });
    }
    if (!profileIds.has(value.applicationDefaultProfileId)) {
      context.addIssue({
        code: "custom",
        path: ["applicationDefaultProfileId"],
        message: "The application default Model Profile must exist",
      });
    }
    if (
      value.projectDefaultProfileId &&
      !profileIds.has(value.projectDefaultProfileId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["projectDefaultProfileId"],
        message: "The project default Model Profile must exist",
      });
    }
    const overriddenScopes = new Set<string>();
    for (const [index, override] of value.stageOverrides.entries()) {
      if (!profileIds.has(override.profileId)) {
        context.addIssue({
          code: "custom",
          path: ["stageOverrides", index, "profileId"],
          message: "The overridden Model Profile must exist",
        });
      }
      if (overriddenScopes.has(override.scope)) {
        context.addIssue({
          code: "custom",
          path: ["stageOverrides", index, "scope"],
          message: "A stage can have only one Model Profile override",
        });
      }
      overriddenScopes.add(override.scope);
    }
    if (value.fallback === "explicit_profile" && !value.fallbackProfileId) {
      context.addIssue({
        code: "custom",
        path: ["fallbackProfileId"],
        message: "An explicit fallback requires a Model Profile",
      });
    }
    if (value.fallback === "pause" && value.fallbackProfileId) {
      context.addIssue({
        code: "custom",
        path: ["fallbackProfileId"],
        message: "A paused policy cannot configure a fallback Model Profile",
      });
    }
    if (value.fallbackProfileId && !profileIds.has(value.fallbackProfileId)) {
      context.addIssue({
        code: "custom",
        path: ["fallbackProfileId"],
        message: "The fallback Model Profile must exist",
      });
    }
  });

export const modelSelectionSourceSchema = z.enum([
  "run_override",
  "stage_override",
  "project_default",
  "application_default",
  "fallback",
]);

export const modelRunSnapshotSchema = z
  .object({
    snapshotId: developmentIdSchema,
    routeRequestId: developmentIdSchema,
    agentRunId: developmentIdSchema,
    policyId: developmentIdSchema,
    scope: modelStageScopeSchema,
    selectionSource: modelSelectionSourceSchema,
    profile: modelProfileSchema,
    policyHash: developmentHashSchema,
    profileHash: developmentHashSchema,
    configurationHash: developmentHashSchema,
    promptVersion: developmentSemverSchema,
    toolPolicyVersion: developmentSemverSchema,
    contextHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const modelFallbackEventSchema = z
  .object({
    fallbackEventId: developmentIdSchema,
    routeRequestId: developmentIdSchema,
    fromAgentRunId: developmentIdSchema,
    toAgentRunId: developmentIdSchema,
    originalProfileId: developmentIdSchema,
    fallbackProfileId: developmentIdSchema,
    reason: z.enum(["provider_unavailable", "provider_timeout"]),
    confirmedBy: developmentIdSchema,
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentInputSnapshotSchema = z
  .object({
    developmentRunId: developmentIdSchema,
    envelopeId: developmentIdSchema,
    envelopeHash: developmentHashSchema,
    workspaceId: developmentIdSchema,
    projectId: developmentIdSchema,
    planningWorkflowRunId: developmentIdSchema,
    projectSpecVersionId: developmentIdSchema,
    projectSpecHash: developmentHashSchema,
    technicalDesignVersionId: developmentIdSchema,
    technicalDesignHash: developmentHashSchema,
    executionPlanVersionId: developmentIdSchema,
    executionPlanHash: developmentHashSchema,
    approvalIds: z.array(developmentIdSchema).length(3),
    workflowDefinitionVersion: developmentSemverSchema,
    workflowDefinitionChecksum: developmentHashSchema,
    validationPolicyVersion: developmentSemverSchema,
    taskGraphHash: developmentHashSchema,
    workspaceBaselineHash: developmentHashSchema,
    modelPolicySnapshotId: developmentIdSchema,
    toolPolicyVersion: developmentSemverSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentRunSchema = z
  .object({
    developmentRunId: developmentIdSchema,
    input: developmentInputSnapshotSchema,
    status: developmentRunStatusSchema,
    revision: z.number().int().nonnegative(),
    currentPhaseRunId: developmentIdSchema.optional(),
    currentTaskRunId: developmentIdSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const phaseRunSchema = z
  .object({
    phaseRunId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    executionPhaseId: developmentIdSchema,
    taskRunIds: z.array(developmentIdSchema).min(1),
    status: phaseRunStatusSchema,
    revision: z.number().int().nonnegative(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const taskRunSchema = z
  .object({
    taskRunId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    executionTaskId: developmentIdSchema,
    taskDefinitionHash: developmentHashSchema,
    status: taskRunStatusSchema,
    revision: z.number().int().nonnegative(),
    modelSnapshotId: developmentIdSchema.optional(),
    agentRunIds: z.array(developmentIdSchema),
    evidenceIds: z.array(developmentIdSchema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const agentRunSchema = z
  .object({
    agentRunId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    purpose: z.enum(["implementation", "review", "repair"]),
    modelSnapshotId: developmentIdSchema,
    status: agentRunStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const patchFileOperationSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    relativePath: z.string().trim().min(1).max(1000),
    beforeHash: developmentHashSchema.optional(),
    afterHash: developmentHashSchema.optional(),
  })
  .strict();

export const patchSetSchema = z
  .object({
    patchSetId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    idempotencyKey: developmentIdSchema,
    operations: z.array(patchFileOperationSchema).min(1),
    status: z.enum(["proposed", "applied", "verified", "rolled_back"]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const contextSourceKindSchema = z.enum([
  "execution_task",
  "requirement",
  "acceptance_criterion",
  "design_item",
  "technical_module",
  "security_rule",
  "dependency_evidence",
  "workspace_file",
  "repository_instruction",
  "project_constraint",
]);

export const untrustedContextBlockSchema = z
  .object({
    blockId: developmentIdSchema,
    kind: contextSourceKindSchema,
    sourceId: z.string().trim().min(1).max(1000),
    sourceHash: developmentHashSchema,
    content: z.string().max(200_000),
    trust: z.literal("untrusted_reference"),
    instructionAuthority: z.literal("none"),
    inclusionReason: z.string().trim().min(1).max(500),
    redacted: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export const contextSourceRecordSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(1000),
    sourceHash: developmentHashSchema,
    kind: contextSourceKindSchema,
    includedBlockIds: z.array(developmentIdSchema).min(1),
    redacted: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export const taskContextSnapshotSchema = z
  .object({
    contextSnapshotId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    agentRunId: developmentIdSchema,
    executionTaskId: developmentIdSchema,
    taskDefinitionHash: developmentHashSchema,
    projectSpecVersionId: developmentIdSchema,
    technicalDesignVersionId: developmentIdSchema,
    executionPlanVersionId: developmentIdSchema,
    allowedWritePaths: z.array(z.string().trim().min(1).max(1000)).min(1),
    blocks: z.array(untrustedContextBlockSchema).min(1),
    sources: z.array(contextSourceRecordSchema).min(1),
    excludedCategories: z.array(
      z.enum([
        "full_chat_history",
        "unrelated_planning_sections",
        "sensitive_files",
        "git_history",
        "other_workspaces",
        "raw_attachments",
      ]),
    ),
    contextHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const proposalFileOperationSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    relativePath: z.string().trim().min(1).max(1000),
    beforeHash: developmentHashSchema.optional(),
    content: z.string().max(5_000_000).optional(),
    rationale: z.string().trim().min(1).max(1000),
    requirementIds: z.array(developmentIdSchema).min(1),
    designItemIds: z.array(developmentIdSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "create" && value.beforeHash) {
      context.addIssue({
        code: "custom",
        path: ["beforeHash"],
        message: "Create operations cannot declare a before Hash",
      });
    }
    if (value.operation !== "create" && !value.beforeHash) {
      context.addIssue({
        code: "custom",
        path: ["beforeHash"],
        message: "Update and delete operations require a before Hash",
      });
    }
    if (value.operation !== "delete" && value.content === undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Create and update operations require content",
      });
    }
    if (value.operation === "delete" && value.content !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Delete operations cannot carry replacement content",
      });
    }
  });

export const dependencyChangeSchema = z
  .object({
    packageName: z.string().trim().min(1).max(240),
    version: z.string().trim().min(1).max(120),
    source: z.enum(["registry", "workspace", "url"]),
    rationale: z.string().trim().min(1).max(1000),
  })
  .strict();

export const changeProposalSchema = z
  .object({
    proposalId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    agentRunId: developmentIdSchema,
    contextSnapshotId: developmentIdSchema,
    contextHash: developmentHashSchema,
    modelSnapshotId: developmentIdSchema,
    summary: z.string().trim().min(1).max(2000),
    operations: z.array(proposalFileOperationSchema).min(1).max(50),
    dependencyChanges: z.array(dependencyChangeSchema),
    riskNotes: z.array(z.string().trim().min(1).max(1000)),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const patchPreviewSchema = z
  .object({
    previewId: developmentIdSchema,
    proposalId: developmentIdSchema,
    proposalHash: developmentHashSchema,
    fileCount: z.number().int().positive(),
    totalContentBytes: z.number().int().nonnegative(),
    structuredDiff: z.string().min(1).max(5_000_000),
    diffHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const rollbackFileOperationSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    relativePath: z.string().trim().min(1).max(1000),
    expectedBeforeHash: developmentHashSchema.optional(),
    content: z.string().max(5_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "create" && value.expectedBeforeHash) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message: "Rollback create cannot declare an existing file Hash",
      });
    }
    if (value.operation !== "create" && !value.expectedBeforeHash) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message: "Rollback update and delete require the applied file Hash",
      });
    }
    if (value.operation !== "delete" && value.content === undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Rollback create and update require content",
      });
    }
    if (value.operation === "delete" && value.content !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Rollback delete cannot carry content",
      });
    }
  });

export const patchJournalOperationSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    relativePath: z.string().trim().min(1).max(1000),
    beforeHash: developmentHashSchema.optional(),
    afterHash: developmentHashSchema.optional(),
    rollback: rollbackFileOperationSchema,
    requirementIds: z.array(developmentIdSchema).min(1),
    designItemIds: z.array(developmentIdSchema).min(1),
  })
  .strict();

export const patchJournalEntrySchema = z
  .object({
    journalEntryId: developmentIdSchema,
    patchSetId: developmentIdSchema,
    proposalId: developmentIdSchema,
    proposalHash: developmentHashSchema,
    idempotencyKey: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    agentRunId: developmentIdSchema,
    contextSnapshotId: developmentIdSchema,
    modelSnapshotId: developmentIdSchema,
    status: z.enum([
      "applied",
      "rejected",
      "conflict",
      "rolled_back",
      "rollback_failed",
    ]),
    operations: z.array(patchJournalOperationSchema),
    workspaceManifestBeforeHash: developmentHashSchema,
    workspaceManifestAfterHash: developmentHashSchema,
    diffHash: developmentHashSchema,
    toolPolicyVersion: developmentSemverSchema,
    rollbackAvailable: z.boolean(),
    appliedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const patchTransactionReasonSchema = z.enum([
  "applied",
  "duplicate",
  "binding_mismatch",
  "path_denied",
  "hash_conflict",
  "invalid_content",
  "size_limit_exceeded",
  "binary_content_rejected",
  "sensitive_content_rejected",
  "license_review_required",
  "dependency_confirmation_required",
  "delete_confirmation_required",
  "single_writer_busy",
  "apply_failed_rolled_back",
  "apply_failed_rollback_failed",
]);

export const patchTransactionResultSchema = z
  .object({
    applied: z.boolean(),
    reason: patchTransactionReasonSchema,
    patchSetId: developmentIdSchema,
    preview: patchPreviewSchema.optional(),
    journalEntry: patchJournalEntrySchema.optional(),
  })
  .strict();

export const developmentEvidenceTypeSchema = z.enum([
  "test_report",
  "typecheck_report",
  "lint_report",
  "build_report",
  "file_hash_manifest",
  "structured_diff",
  "runtime_log",
  "manual_confirmation",
  "rollback_report",
  "screenshot",
  "security_report",
]);

export const verificationErrorCategorySchema = z.enum([
  "none",
  "verification_failed",
  "command_not_found",
  "timeout",
  "policy_denied",
  "infrastructure_failure",
]);

export const verificationLogArtifactSchema = z
  .object({
    artifactId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    verificationStepId: developmentIdSchema,
    commandRequestId: developmentIdSchema.optional(),
    source: z.enum(["command_output", "manual_record"]),
    content: z.string().max(4_000_000),
    contentHash: developmentHashSchema,
    byteLength: z.number().int().nonnegative().max(4_000_000),
    truncated: z.boolean(),
    redacted: z.literal(true),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const verificationEvidenceSchema = z
  .object({
    evidenceId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    verificationStepId: developmentIdSchema,
    taskDefinitionHash: developmentHashSchema,
    modelSnapshotId: developmentIdSchema,
    type: developmentEvidenceTypeSchema,
    producer: z.enum(["verification_runner", "user", "system"]),
    artifactId: developmentIdSchema,
    artifactHash: developmentHashSchema,
    patchJournalEntryId: developmentIdSchema,
    commandResultHash: developmentHashSchema.optional(),
    exitCode: z.number().int().optional(),
    errorCategory: verificationErrorCategorySchema,
    summary: z.string().trim().min(1).max(2000),
    confirmationId: developmentIdSchema.optional(),
    workspaceHash: developmentHashSchema,
    outcome: z.enum(["passed", "failed", "requires_review"]),
    producedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.producer === "verification_runner" &&
      (value.commandResultHash === undefined || value.exitCode === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["commandResultHash"],
        message: "Runner Evidence requires a command result Hash and Exit Code",
      });
    }
    if (value.producer === "user" && !value.confirmationId) {
      context.addIssue({
        code: "custom",
        path: ["confirmationId"],
        message: "User Evidence requires an explicit confirmation",
      });
    }
    if (
      value.outcome === "passed" &&
      (value.errorCategory !== "none" ||
        (value.producer === "verification_runner" && value.exitCode !== 0))
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Passed Evidence cannot contain a failure",
      });
    }
    if (
      value.outcome === "failed" &&
      (value.errorCategory === "none" || value.exitCode === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Failed Evidence requires a classified failure",
      });
    }
  });

export const evidenceManifestSchema = z
  .object({
    manifestId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    taskDefinitionHash: developmentHashSchema,
    modelSnapshotId: developmentIdSchema,
    patchJournalEntryId: developmentIdSchema,
    workspaceHash: developmentHashSchema,
    evidenceIds: z.array(developmentIdSchema).min(1),
    requiredVerificationStepIds: z.array(developmentIdSchema),
    passedRequiredStepIds: z.array(developmentIdSchema),
    status: z.enum(["passed", "failed", "requires_review"]),
    manifestHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const verificationRunResultSchema = z
  .object({
    verificationRunId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    manifest: evidenceManifestSchema,
    evidence: z.array(verificationEvidenceSchema).min(1),
    artifacts: z.array(verificationLogArtifactSchema).min(1),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const repairAttemptSchema = z
  .object({
    repairAttemptId: developmentIdSchema,
    attemptNumber: z.number().int().positive(),
    agentRunId: developmentIdSchema,
    modelSnapshotId: developmentIdSchema,
    patchSetId: developmentIdSchema,
    failureEvidenceId: developmentIdSchema,
    failureFingerprint: developmentHashSchema,
    errorCategory: verificationErrorCategorySchema.exclude(["none"]),
    status: z.enum([
      "proposed",
      "patch_applied",
      "verification_failed",
      "verified",
    ]),
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const repairSessionSchema = z
  .object({
    repairSessionId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    maxAttempts: z.number().int().min(0).max(10),
    attempts: z.array(repairAttemptSchema).max(10),
    status: z.enum(["available", "repairing", "verified", "needs_user_action"]),
    stopReason: z
      .enum([
        "budget_exhausted",
        "repeated_failure",
        "policy_failure",
        "infrastructure_failure",
      ])
      .optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const agentIds = new Set(value.attempts.map(({ agentRunId }) => agentRunId));
    const patchIds = new Set(value.attempts.map(({ patchSetId }) => patchSetId));
    if (
      agentIds.size !== value.attempts.length ||
      patchIds.size !== value.attempts.length ||
      value.attempts.length > value.maxAttempts
    ) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "Repair attempts require unique Agent/Patch IDs within budget",
      });
    }
    if (value.status === "needs_user_action" && !value.stopReason) {
      context.addIssue({
        code: "custom",
        path: ["stopReason"],
        message: "A stopped Repair Session requires a reason",
      });
    }
  });

export const repairContextSnapshotSchema = z
  .object({
    repairContextId: developmentIdSchema,
    repairSessionId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    sourceContextSnapshotId: developmentIdSchema,
    sourceContextHash: developmentHashSchema,
    failureEvidenceId: developmentIdSchema,
    failureArtifactHash: developmentHashSchema,
    failureFingerprint: developmentHashSchema,
    errorCategory: verificationErrorCategorySchema.exclude(["none"]),
    redactedFailureSummary: z.string().trim().min(1).max(2000),
    previousRepairAttemptIds: z.array(developmentIdSchema),
    allowedWritePaths: z.array(z.string().trim().min(1).max(1000)).min(1),
    contextHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const repairDecisionSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.enum([
      "repair_allowed",
      "budget_exhausted",
      "repeated_failure",
      "policy_failure",
      "infrastructure_failure",
    ]),
    session: repairSessionSchema,
    attempt: repairAttemptSchema.optional(),
    context: repairContextSnapshotSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.allowed && (!value.attempt || !value.context)) {
      context.addIssue({
        code: "custom",
        path: ["attempt"],
        message: "An allowed Repair requires an Attempt and Repair Context",
      });
    }
    if (!value.allowed && (value.attempt || value.context)) {
      context.addIssue({
        code: "custom",
        path: ["attempt"],
        message: "A stopped Repair cannot create an Attempt or Context",
      });
    }
  });

export const patchRollbackFileResultSchema = z
  .object({
    relativePath: z.string().trim().min(1).max(1000),
    operation: z.enum(["create", "update", "delete"]),
    beforeHash: developmentHashSchema.optional(),
    afterHash: developmentHashSchema.optional(),
  })
  .strict();

export const patchRollbackResultSchema = z
  .object({
    rollbackId: developmentIdSchema,
    patchSetId: developmentIdSchema,
    journalEntryId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    rolledBack: z.boolean(),
    reason: z.enum([
      "rolled_back",
      "binding_mismatch",
      "confirmation_required",
      "hash_conflict",
      "apply_failed",
    ]),
    operations: z.array(patchRollbackFileResultSchema),
    reportHash: developmentHashSchema,
    rolledBackAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const phaseGateDecisionSchema = z
  .object({
    decisionId: developmentIdSchema,
    requestId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    phaseRunId: developmentIdSchema,
    userGateId: developmentIdSchema,
    actorType: z.literal("user"),
    actorId: developmentIdSchema,
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentInvalidationRecordSchema = z
  .object({
    invalidationId: developmentIdSchema,
    causedByRequestId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    kind: z.enum(["planning_revision", "model_snapshot_changed"]),
    targetType: z.enum(["run", "task", "evidence", "gate"]),
    targetId: developmentIdSchema,
    reason: z.string().trim().min(1).max(1000),
    invalidatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentTransitionRecordSchema = z
  .object({
    transitionId: developmentIdSchema,
    requestId: developmentIdSchema,
    entityType: z.enum(["development_run", "phase_run", "task_run", "agent_run"]),
    entityId: developmentIdSchema,
    fromStatus: developmentIdSchema,
    toStatus: developmentIdSchema,
    transitionedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentCommandReasonSchema = z.enum([
  "accepted",
  "duplicate",
  "invalid_status",
  "unknown_task",
  "unknown_phase",
  "dependency_incomplete",
  "evidence_missing",
  "evidence_mismatch",
  "phase_exit_incomplete",
  "user_actor_required",
  "gate_mismatch",
  "stale_input",
  "binding_mismatch",
  "model_snapshot_unchanged",
]);

export const developmentCommandResultSchema = z
  .object({
    requestId: developmentIdSchema,
    accepted: z.boolean(),
    reason: developmentCommandReasonSchema,
    runStatus: developmentRunStatusSchema,
    phaseRunId: developmentIdSchema.optional(),
    taskRunId: developmentIdSchema.optional(),
  })
  .strict();

export const startDevelopmentCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    startedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const beginTaskCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    agentRunId: developmentIdSchema,
    modelSnapshotId: developmentIdSchema,
    begunAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const beginRepairCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    maxAttempts: z.number().int().min(0).max(10),
    attempt: repairAttemptSchema,
    begunAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const requireDevelopmentUserActionCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    reason: z.enum([
      "repair_budget_exhausted",
      "repair_repeated_failure",
      "repair_policy_failure",
      "repair_infrastructure_failure",
      "rollback_conflict",
      "manual_verification_required",
    ]),
    requiredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const recordRepairAttemptCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    repairAttemptId: developmentIdSchema,
    status: z.enum(["patch_applied", "verification_failed", "verified"]),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const transitionTaskCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    toStatus: taskRunStatusSchema,
    transitionedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const recordEvidenceCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    evidence: verificationEvidenceSchema,
  })
  .strict();

export const completeTaskCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    taskRunId: developmentIdSchema,
    evidenceIds: z.array(developmentIdSchema).min(1),
    completedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const confirmPhaseGateCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    decisionId: developmentIdSchema,
    phaseRunId: developmentIdSchema,
    userGateId: developmentIdSchema,
    actorType: z.enum(["user", "model", "system"]),
    actorId: developmentIdSchema,
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const planningRevisionCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    invalidationIdPrefix: developmentIdSchema,
    subjectType: z.enum(["project_spec", "technical_design", "execution_plan"]),
    newVersionId: developmentIdSchema,
    affectedTaskIds: z.array(developmentIdSchema),
    revisedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const rerunTaskWithModelCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    invalidationIdPrefix: developmentIdSchema,
    taskRunId: developmentIdSchema,
    newAgentRunId: developmentIdSchema,
    newModelSnapshotId: developmentIdSchema,
    requestedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentControlCommandSchema = z
  .object({
    requestId: developmentIdSchema,
    action: z.enum(["pause", "resume", "cancel"]),
    actorId: developmentIdSchema,
    reason: z.string().trim().min(1).max(1000),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentCommandKindSchema = z.enum([
  "start",
  "apply",
  "verify",
  "repair",
  "gate",
  "pause",
  "resume",
  "cancel",
  "recovery",
]);

export const developmentSafeBoundarySchema = z.enum([
  "created",
  "task_ready",
  "context_assembled",
  "patch_committed",
  "verification_committed",
  "repair_committed",
  "gate_committed",
  "paused",
  "completed",
  "cancelled",
  "recovery_required",
]);

export const developmentPendingOperationSchema = z
  .object({
    requestId: developmentIdSchema,
    commandKind: developmentCommandKindSchema,
    taskRunId: developmentIdSchema.optional(),
    phaseRunId: developmentIdSchema.optional(),
    operation: z.enum(["applying_patch", "verifying", "repairing"]),
    beforeWorkspaceHash: developmentHashSchema,
    expectedAfterWorkspaceHash: developmentHashSchema.optional(),
    patchJournalEntryId: developmentIdSchema.optional(),
    preparedPatchJournal: patchJournalEntrySchema.optional(),
    startedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.operation === "applying_patch" &&
      (!value.expectedAfterWorkspaceHash ||
        !value.patchJournalEntryId ||
        !value.preparedPatchJournal)
    ) {
      context.addIssue({
        code: "custom",
        message: "A pending Patch requires its expected Workspace Hash and Journal",
      });
    }
    if (
      value.operation === "applying_patch" &&
      value.preparedPatchJournal &&
      (value.preparedPatchJournal.journalEntryId !== value.patchJournalEntryId ||
        value.preparedPatchJournal.taskRunId !== value.taskRunId ||
        value.preparedPatchJournal.workspaceManifestBeforeHash !==
          value.beforeWorkspaceHash ||
        value.preparedPatchJournal.workspaceManifestAfterHash !==
          value.expectedAfterWorkspaceHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["preparedPatchJournal"],
        message: "The prepared Patch Journal must match the pending operation",
      });
    }
  });

export const developmentCommandReceiptSchema = z
  .object({
    requestId: developmentIdSchema,
    commandKind: developmentCommandKindSchema,
    status: z.enum(["committed", "rejected"]),
    aggregateRevision: z.number().int().nonnegative(),
    resultHash: developmentHashSchema,
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentOutboxEventSchema = z
  .object({
    eventId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    sequence: z.number().int().positive(),
    requestId: developmentIdSchema,
    commandKind: developmentCommandKindSchema,
    eventType: z.enum([
      "development.state_changed",
      "development.recovery_required",
      "development.cancelled",
    ]),
    aggregateRevision: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
    payloadHash: developmentHashSchema,
    occurredAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const developmentRecoveryReasonSchema = z.enum([
  "safe_boundary",
  "workspace_drift",
  "planning_stale",
  "uncertain_patch",
  "verification_interrupted",
  "repair_interrupted",
  "checkpoint_corrupt",
]);

export const developmentRecoveryAuditSchema = z
  .object({
    auditId: developmentIdSchema,
    developmentRunId: developmentIdSchema,
    checkpointRevision: z.number().int().positive(),
    reason: developmentRecoveryReasonSchema,
    disposition: z.enum([
      "resume",
      "resume_verification",
      "finalize_patch",
      "manual_review",
      "blocked",
    ]),
    envelopeHash: developmentHashSchema,
    expectedWorkspaceHash: developmentHashSchema,
    actualWorkspaceHash: developmentHashSchema,
    pendingRequestId: developmentIdSchema.optional(),
    auditedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const workspacePolicySchema = z
  .object({
    policyVersion: developmentSemverSchema,
    ignoredPathSegments: z.array(z.string().trim().min(1).max(120)),
    sensitivePathPatterns: z.array(z.string().trim().min(1).max(240)).min(1),
    maxFileSizeBytes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    followSymlinks: z.literal(false),
  })
  .strict();

export const workspaceFileRecordSchema = z
  .object({
    relativePath: z.string().trim().min(1).max(1000),
    sizeBytes: z.number().int().nonnegative(),
    contentHash: developmentHashSchema,
    userModified: z.boolean(),
  })
  .strict();

export const workspaceGitBaselineSchema = z
  .object({
    isRepository: z.boolean(),
    commit: z.string().trim().min(1).max(160).optional(),
    branch: z.string().trim().min(1).max(240).optional(),
    dirtyPaths: z.array(z.string().trim().min(1).max(1000)),
  })
  .strict();

export const workspaceInstructionSchema = z
  .object({
    relativePath: z.string().trim().min(1).max(1000),
    contentHash: developmentHashSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const workspaceBaselineSchema = z
  .object({
    baselineId: developmentIdSchema,
    workspaceRoot: z.string().trim().min(1).max(4000),
    workspaceRootHash: developmentHashSchema,
    policyVersion: developmentSemverSchema,
    files: z.array(workspaceFileRecordSchema),
    instructions: z.array(workspaceInstructionSchema),
    git: workspaceGitBaselineSchema,
    ignoredPathSegments: z.array(z.string().trim().min(1).max(120)),
    sensitivePathPatterns: z.array(z.string().trim().min(1).max(240)),
    baselineHash: developmentHashSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const workspaceOperationSchema = z.enum([
  "list",
  "read",
  "search",
  "patch",
  "command",
]);

export const workspacePathDecisionReasonSchema = z.enum([
  "allowed",
  "outside_workspace",
  "absolute_path",
  "path_traversal",
  "sensitive_path",
  "ignored_path",
  "symlink_rejected",
  "not_found",
  "not_file",
  "file_too_large",
  "file_limit_exceeded",
  "hash_conflict",
  "confirmation_required",
  "operation_denied",
]);

export const workspacePathDecisionSchema = z
  .object({
    allowed: z.boolean(),
    reason: workspacePathDecisionReasonSchema,
    normalizedRelativePath: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

export const workspaceListRequestSchema = z
  .object({
    requestId: developmentIdSchema,
    relativePath: z.string().max(1000),
  })
  .strict();

export const workspaceReadRequestSchema = z
  .object({
    requestId: developmentIdSchema,
    relativePath: z.string().trim().min(1).max(1000),
  })
  .strict();

export const workspaceSearchRequestSchema = z
  .object({
    requestId: developmentIdSchema,
    relativePath: z.string().max(1000),
    literalQuery: z.string().min(1).max(500),
    maxResults: z.number().int().positive().max(1000),
  })
  .strict();

export const workspacePatchRequestSchema = z
  .object({
    requestId: developmentIdSchema,
    relativePath: z.string().trim().min(1).max(1000),
    operation: z.enum(["create", "update", "delete"]),
    expectedBeforeHash: developmentHashSchema.optional(),
    content: z.string().max(5_000_000).optional(),
    confirmationId: developmentIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.operation === "create" && value.expectedBeforeHash) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message: "Create cannot declare an existing file hash",
      });
    }
    if (value.operation !== "delete" && value.content === undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Create and update require content",
      });
    }
    if (value.operation !== "create" && !value.expectedBeforeHash) {
      context.addIssue({
        code: "custom",
        path: ["expectedBeforeHash"],
        message: "Update and delete require the previously read content hash",
      });
    }
  });

export const structuredCommandKindSchema = z.enum([
  "format",
  "lint",
  "typecheck",
  "test",
  "build",
  "install_dependency",
  "delete",
  "bulk_rewrite",
  "git_commit",
  "git_tag",
  "git_push",
  "network",
  "deploy",
  "production_write",
  "credential_access",
]);

const commandArgumentSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9@%_+.,:/=~-]+$/);

export const structuredCommandTemplateSchema = z
  .object({
    templateId: developmentIdSchema,
    kind: structuredCommandKindSchema,
    executable: z.enum(["pnpm", "npm", "yarn", "bun", "cargo", "go", "uv", "git"]),
    args: z.array(commandArgumentSchema).max(64),
    timeoutMs: z.number().int().positive().max(30 * 60 * 1000),
  })
  .strict();

export const toolConfirmationSchema = z
  .object({
    confirmationId: developmentIdSchema,
    actorType: z.literal("user"),
    actorId: developmentIdSchema,
    templateId: developmentIdSchema.optional(),
    relativePaths: z.array(z.string().trim().min(1).max(1000)),
    confirmedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const structuredCommandRequestSchema = z
  .object({
    requestId: developmentIdSchema,
    templateId: developmentIdSchema,
    cwdRelativePath: z.string().max(1000),
    confirmation: toolConfirmationSchema.optional(),
  })
  .strict();

export const toolPolicyDispositionSchema = z.enum([
  "allowed",
  "requires_confirmation",
  "denied",
]);

export const toolPolicyDecisionSchema = z
  .object({
    decisionId: developmentIdSchema,
    requestId: developmentIdSchema,
    policyVersion: developmentSemverSchema,
    operation: workspaceOperationSchema,
    disposition: toolPolicyDispositionSchema,
    reason: z.enum([
      "approved_template",
      "user_confirmation_required",
      "user_confirmed",
      "unknown_template",
      "unsafe_template",
      "permanently_denied",
      "path_policy_denied",
      "hash_conflict",
    ]),
    decidedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const toolEventSchema = z
  .object({
    eventId: developmentIdSchema,
    requestId: developmentIdSchema,
    decisionId: developmentIdSchema,
    operation: workspaceOperationSchema,
    disposition: toolPolicyDispositionSchema,
    redactedArguments: z.array(z.string().trim().min(1).max(240)).max(16),
    resultSummary: z.string().trim().min(1).max(2000),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const serialized = [...value.redactedArguments, value.resultSummary].join("\n");
    if (
      /\/Users\/[^/]+\/|\/home\/[^/]+\/|[A-Za-z]:\\Users\\[^\\]+\\/i.test(
        serialized,
      ) ||
      /(?:sk|pk|api|token|secret)[-_][A-Za-z0-9_-]{8,}/i.test(serialized) ||
      /(?:ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/i.test(serialized) ||
      /AKIA[0-9A-Z]{16}/.test(serialized) ||
      /Bearer\s+(?!\[REDACTED\])\S+/i.test(serialized) ||
      /(?:password|token|secret|api[_-]?key)\s*[=:]\s*(?!\[REDACTED\])\S+/i.test(
        serialized,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["redactedArguments"],
        message: "Tool Events cannot contain personal roots or credential-like values",
      });
    }
  });

export const structuredCommandResultSchema = z
  .object({
    executed: z.boolean(),
    decision: toolPolicyDecisionSchema,
    event: toolEventSchema,
    failureCategory: verificationErrorCategorySchema,
    exitCode: z.number().int().optional(),
    stdout: z.string().max(2_000_000).optional(),
    stderr: z.string().max(2_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.executed &&
      ((value.exitCode === 0 && value.failureCategory !== "none") ||
        (value.exitCode !== 0 && value.failureCategory === "none"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["failureCategory"],
        message: "Command failure category must match the Exit Code",
      });
    }
    if (!value.executed && value.failureCategory !== "policy_denied") {
      context.addIssue({
        code: "custom",
        path: ["failureCategory"],
        message: "A policy-denied command was not executed",
      });
    }
  });

export const developmentContractManifestSchema = z
  .object({
    contractVersion: developmentSemverSchema,
    sourceRevision: z.string().trim().min(1),
    workflowKey: developmentIdSchema,
    workflowVersion: developmentSemverSchema,
    definitionChecksum: developmentHashSchema,
    inputSchemaVersion: developmentSemverSchema,
    eventSchemaVersion: developmentSemverSchema,
    validationPolicyVersion: developmentSemverSchema,
    toolPolicyVersion: developmentSemverSchema,
    minimumPlanningContractVersion: developmentSemverSchema,
    minimumRuntimeCapability: developmentSemverSchema,
  })
  .strict();

export type DevelopmentRunStatus = z.infer<typeof developmentRunStatusSchema>;
export type TaskRunStatus = z.infer<typeof taskRunStatusSchema>;
export type PhaseRunStatus = z.infer<typeof phaseRunStatusSchema>;
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type ModelStageScope = z.infer<typeof modelStageScopeSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelCapabilityRequirement = z.infer<
  typeof modelCapabilityRequirementSchema
>;
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export type ModelSelectionSource = z.infer<typeof modelSelectionSourceSchema>;
export type ModelRunSnapshot = z.infer<typeof modelRunSnapshotSchema>;
export type ModelFallbackEvent = z.infer<typeof modelFallbackEventSchema>;
export type DevelopmentInputSnapshot = z.infer<
  typeof developmentInputSnapshotSchema
>;
export type DevelopmentRun = z.infer<typeof developmentRunSchema>;
export type PhaseRun = z.infer<typeof phaseRunSchema>;
export type TaskRun = z.infer<typeof taskRunSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type PatchSet = z.infer<typeof patchSetSchema>;
export type ContextSourceKind = z.infer<typeof contextSourceKindSchema>;
export type UntrustedContextBlock = z.infer<
  typeof untrustedContextBlockSchema
>;
export type ContextSourceRecord = z.infer<typeof contextSourceRecordSchema>;
export type TaskContextSnapshot = z.infer<typeof taskContextSnapshotSchema>;
export type ProposalFileOperation = z.infer<typeof proposalFileOperationSchema>;
export type DependencyChange = z.infer<typeof dependencyChangeSchema>;
export type ChangeProposal = z.infer<typeof changeProposalSchema>;
export type PatchPreview = z.infer<typeof patchPreviewSchema>;
export type RollbackFileOperation = z.infer<typeof rollbackFileOperationSchema>;
export type PatchJournalOperation = z.infer<typeof patchJournalOperationSchema>;
export type PatchJournalEntry = z.infer<typeof patchJournalEntrySchema>;
export type PatchTransactionReason = z.infer<
  typeof patchTransactionReasonSchema
>;
export type PatchTransactionResult = z.infer<
  typeof patchTransactionResultSchema
>;
export type VerificationErrorCategory = z.infer<
  typeof verificationErrorCategorySchema
>;
export type DevelopmentEvidenceType = z.infer<
  typeof developmentEvidenceTypeSchema
>;
export type VerificationLogArtifact = z.infer<
  typeof verificationLogArtifactSchema
>;
export type VerificationEvidence = z.infer<typeof verificationEvidenceSchema>;
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export type VerificationRunResult = z.infer<typeof verificationRunResultSchema>;
export type RepairAttempt = z.infer<typeof repairAttemptSchema>;
export type RepairSession = z.infer<typeof repairSessionSchema>;
export type RepairContextSnapshot = z.infer<
  typeof repairContextSnapshotSchema
>;
export type RepairDecision = z.infer<typeof repairDecisionSchema>;
export type PatchRollbackFileResult = z.infer<
  typeof patchRollbackFileResultSchema
>;
export type PatchRollbackResult = z.infer<typeof patchRollbackResultSchema>;
export type PhaseGateDecision = z.infer<typeof phaseGateDecisionSchema>;
export type DevelopmentInvalidationRecord = z.infer<
  typeof developmentInvalidationRecordSchema
>;
export type DevelopmentTransitionRecord = z.infer<
  typeof developmentTransitionRecordSchema
>;
export type DevelopmentCommandReason = z.infer<
  typeof developmentCommandReasonSchema
>;
export type DevelopmentCommandResult = z.infer<
  typeof developmentCommandResultSchema
>;
export type StartDevelopmentCommand = z.infer<
  typeof startDevelopmentCommandSchema
>;
export type BeginTaskCommand = z.infer<typeof beginTaskCommandSchema>;
export type BeginRepairCommand = z.infer<typeof beginRepairCommandSchema>;
export type RequireDevelopmentUserActionCommand = z.infer<
  typeof requireDevelopmentUserActionCommandSchema
>;
export type RecordRepairAttemptCommand = z.infer<
  typeof recordRepairAttemptCommandSchema
>;
export type TransitionTaskCommand = z.infer<typeof transitionTaskCommandSchema>;
export type RecordEvidenceCommand = z.infer<typeof recordEvidenceCommandSchema>;
export type CompleteTaskCommand = z.infer<typeof completeTaskCommandSchema>;
export type ConfirmPhaseGateCommand = z.infer<
  typeof confirmPhaseGateCommandSchema
>;
export type PlanningRevisionCommand = z.infer<
  typeof planningRevisionCommandSchema
>;
export type RerunTaskWithModelCommand = z.infer<
  typeof rerunTaskWithModelCommandSchema
>;
export type DevelopmentControlCommand = z.infer<
  typeof developmentControlCommandSchema
>;
export type DevelopmentCommandKind = z.infer<
  typeof developmentCommandKindSchema
>;
export type DevelopmentSafeBoundary = z.infer<
  typeof developmentSafeBoundarySchema
>;
export type DevelopmentPendingOperation = z.infer<
  typeof developmentPendingOperationSchema
>;
export type DevelopmentCommandReceipt = z.infer<
  typeof developmentCommandReceiptSchema
>;
export type DevelopmentOutboxEvent = z.infer<
  typeof developmentOutboxEventSchema
>;
export type DevelopmentRecoveryReason = z.infer<
  typeof developmentRecoveryReasonSchema
>;
export type DevelopmentRecoveryAudit = z.infer<
  typeof developmentRecoveryAuditSchema
>;
export type WorkspacePolicy = z.infer<typeof workspacePolicySchema>;
export type WorkspaceFileRecord = z.infer<typeof workspaceFileRecordSchema>;
export type WorkspaceGitBaseline = z.infer<typeof workspaceGitBaselineSchema>;
export type WorkspaceInstruction = z.infer<typeof workspaceInstructionSchema>;
export type WorkspaceBaseline = z.infer<typeof workspaceBaselineSchema>;
export type WorkspaceOperation = z.infer<typeof workspaceOperationSchema>;
export type WorkspacePathDecisionReason = z.infer<
  typeof workspacePathDecisionReasonSchema
>;
export type WorkspacePathDecision = z.infer<
  typeof workspacePathDecisionSchema
>;
export type WorkspaceListRequest = z.infer<typeof workspaceListRequestSchema>;
export type WorkspaceReadRequest = z.infer<typeof workspaceReadRequestSchema>;
export type WorkspaceSearchRequest = z.infer<
  typeof workspaceSearchRequestSchema
>;
export type WorkspacePatchRequest = z.infer<typeof workspacePatchRequestSchema>;
export type StructuredCommandKind = z.infer<typeof structuredCommandKindSchema>;
export type StructuredCommandTemplate = z.infer<
  typeof structuredCommandTemplateSchema
>;
export type ToolConfirmation = z.infer<typeof toolConfirmationSchema>;
export type StructuredCommandRequest = z.infer<
  typeof structuredCommandRequestSchema
>;
export type ToolPolicyDisposition = z.infer<
  typeof toolPolicyDispositionSchema
>;
export type ToolPolicyDecision = z.infer<typeof toolPolicyDecisionSchema>;
export type ToolEvent = z.infer<typeof toolEventSchema>;
export type StructuredCommandResult = z.infer<
  typeof structuredCommandResultSchema
>;
export type DevelopmentContractManifest = z.infer<
  typeof developmentContractManifestSchema
>;

export interface ModelProviderRequest {
  requestId: string;
  scope: ModelStageScope;
  systemInstructions: string;
  input: Readonly<Record<string, unknown>>;
  responseFormat: "json" | "text";
  contextTokens: number;
  tools?: readonly Readonly<Record<string, unknown>>[];
}

export interface ModelProviderResponse {
  providerRequestId: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type ModelProviderFailureCode =
  | "unavailable"
  | "timeout"
  | "authentication_failed"
  | "invalid_response"
  | "configuration_error";

export type ModelProviderResult =
  | { success: true; response: ModelProviderResponse }
  | {
      success: false;
      code: ModelProviderFailureCode;
      message: string;
      recoverable: boolean;
    };

export type ModelConnectionResult =
  | { connected: true; latencyMs: number }
  | {
      connected: false;
      code: ModelProviderFailureCode;
      message: string;
      recoverable: boolean;
    };

export interface ModelProviderPort {
  readonly providerType: ModelProfile["providerType"];
  testConnection(profile: ModelProfile): Promise<ModelConnectionResult>;
  generate(
    profile: ModelProfile,
    request: ModelProviderRequest,
  ): Promise<ModelProviderResult>;
}

export { developmentContractManifest } from "./manifest.js";
