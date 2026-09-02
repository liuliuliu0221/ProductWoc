import { z } from "zod";

export const PLANNING_WORKFLOW_KEY = "product-factory-planning";
export const PLANNING_WORKFLOW_VERSION = "2.0.0";
export const PLANNING_INPUT_SCHEMA_VERSION = "2.0.0";
export const PLANNING_EVENT_SCHEMA_VERSION = "1.0.0";
export const PLANNING_APPROVAL_POLICY_VERSION = "2.0.0";

export const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const planningStageSchema = z.enum([
  "discovery",
  "product_spec",
  "technical_design",
  "execution_plan",
]);

export const planningSubjectSchema = z.enum([
  "project_spec",
  "technical_design",
  "execution_plan",
]);

export const planningStatusV2Schema = z.enum([
  "collecting_idea",
  "analyzing_request",
  "awaiting_clarification",
  "generating_product_spec",
  "awaiting_product_spec_approval",
  "generating_technical_design",
  "awaiting_technical_design_approval",
  "generating_execution_plan",
  "awaiting_execution_plan_approval",
  "needs_user_action",
  "ready_for_development",
  "cancelled",
]);

export const planningWorkflowInputV2Schema = z
  .object({
    workspaceId: idSchema,
    projectId: idSchema,
    requestedBy: idSchema,
    requestId: idSchema,
    idea: z.string().trim().min(3).max(4000),
    workflowVersion: semverSchema,
    approvalPolicyVersion: semverSchema,
    referenceArtifactIds: z.array(idSchema).max(20).optional(),
  })
  .strict();

export const supportAssessmentSchema = z
  .object({
    level: z.enum(["supported", "needs_user_action", "unsupported"]),
    reason: z.string().trim().min(1).max(1000),
    safeFallback: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.level !== "supported" && !value.safeFallback) {
      context.addIssue({
        code: "custom",
        path: ["safeFallback"],
        message: "A safe fallback is required when the request is not supported",
      });
    }
  });

export const planningAssumptionSchema = z
  .object({
    id: idSchema,
    statement: z.string().trim().min(1).max(1000),
    source: z.enum(["recommended_default", "user", "verified_fact"]),
    overridable: z.boolean(),
  })
  .strict();

export const discoveryUncertaintySchema = z
  .object({
    id: idSchema,
    topic: z.string().trim().min(1).max(160),
    question: z.string().trim().min(1).max(1000),
    recommendedDefault: z.string().trim().min(1).max(1000),
    impact: z.string().trim().min(1).max(1000),
    blocking: z.boolean(),
    score: z.number().min(0).max(1),
  })
  .strict();

export const requirementUnderstandingSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    targetUsers: z.array(z.string().trim().min(1).max(240)).min(1),
    coreTasks: z.array(z.string().trim().min(1).max(500)).min(1),
    assumptions: z.array(planningAssumptionSchema),
    risks: z.array(z.string().trim().min(1).max(1000)),
    support: supportAssessmentSchema,
    uncertainties: z.array(discoveryUncertaintySchema).max(20),
  })
  .strict();

export const clarificationQuestionSchema = discoveryUncertaintySchema
  .omit({ blocking: true })
  .extend({ blocking: z.literal(true) })
  .strict();

export const discoveryAnalysisSchema = z
  .object({
    understanding: requirementUnderstandingSchema,
    questions: z.array(clarificationQuestionSchema).max(3),
    outcome: z.enum(["ready_for_spec", "awaiting_clarification", "needs_user_action"]),
  })
  .strict();

export const clarificationAnswerSchema = z
  .object({
    questionId: idSchema,
    answer: z.string().trim().min(1).max(4000).optional(),
    useRecommendedDefault: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.answer && !value.useRecommendedDefault) {
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "Provide an answer or adopt the recommended default",
      });
    }
    if (value.answer && value.useRecommendedDefault) {
      context.addIssue({
        code: "custom",
        path: ["useRecommendedDefault"],
        message: "Choose either a custom answer or the recommended default",
      });
    }
  });

export const decisionLogEntrySchema = z
  .object({
    decisionId: idSchema,
    kind: z.enum([
      "clarification_answer",
      "adopted_default",
      "verified_fact",
      "assumption_override",
    ]),
    topic: z.string().trim().min(1).max(160),
    value: z.string().trim().min(1).max(4000),
    sourceQuestionId: idSchema.optional(),
    recordedBy: idSchema,
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const decisionLogSchema = z
  .object({
    entries: z.array(decisionLogEntrySchema),
  })
  .strict();

export const sourceReferenceSchema = z
  .object({
    kind: z.enum(["decision", "artifact", "requirement", "acceptance_criterion"]),
    id: idSchema,
  })
  .strict();

export const acceptanceCriterionSchema = z
  .object({
    id: idSchema,
    description: z.string().trim().min(1).max(1000),
  })
  .strict();

export const requirementSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
    acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
    sources: z.array(sourceReferenceSchema).default([]),
  })
  .strict();

const immutableVersionFields = {
  versionId: idSchema,
  version: z.number().int().positive(),
  normalizedContentHash: hashSchema,
  schemaVersion: semverSchema,
  createdAt: z.string().datetime({ offset: true }),
} as const;

const projectSpecContentFields = {
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(2000),
  targetUsers: z.array(z.string().trim().min(1).max(240)).min(1),
  coreTasks: z.array(z.string().trim().min(1).max(500)).min(1),
  successMetrics: z.array(z.string().trim().min(1).max(500)),
  inScope: z.array(z.string().trim().min(1).max(500)).min(1),
  outOfScope: z.array(z.string().trim().min(1).max(500)),
  requirements: z.array(requirementSchema).min(1),
  assumptions: z.array(z.string().trim().min(1).max(1000)),
  risks: z.array(z.string().trim().min(1).max(1000)),
  openQuestions: z.array(z.string().trim().min(1).max(1000)),
} as const;

export const projectSpecContentSchema = z
  .object(projectSpecContentFields)
  .strict();

export const projectSpecRevisionPatchSchema = projectSpecContentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one Project Spec field is required",
  });

export const projectSpecVersionSchema = z
  .object({
    ...immutableVersionFields,
    ...projectSpecContentFields,
    sourceDecisionIds: z.array(idSchema),
    sourceArtifactIds: z.array(idSchema),
    promptVersion: semverSchema,
    modelSnapshot: z.string().trim().min(1).max(240),
  })
  .strict();

export const designItemSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
    requirementIds: z.array(idSchema).min(1),
    moduleIds: z.array(idSchema).min(1),
  })
  .strict();

export const goldenStackCapabilitySchema = z.enum([
  "web_framework",
  "runtime",
  "language",
  "database",
  "orm",
  "authentication",
  "workflow",
  "sandbox",
  "repository",
  "deployment",
  "object_storage",
]);

export const stackDecisionSchema = z
  .object({
    capability: goldenStackCapabilitySchema,
    selection: z.string().trim().min(1).max(240),
    status: z.enum([
      "compliant",
      "not_applicable",
      "requires_confirmation",
      "approved_exception",
    ]),
    rationale: z.string().trim().min(1).max(1000),
    proposedAlternative: z.string().trim().min(1).max(240).optional(),
    confirmationDecisionId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "requires_confirmation" && !value.proposedAlternative) {
      context.addIssue({
        code: "custom",
        path: ["proposedAlternative"],
        message: "A proposed alternative is required for a stack deviation",
      });
    }
    if (value.status === "approved_exception" && !value.confirmationDecisionId) {
      context.addIssue({
        code: "custom",
        path: ["confirmationDecisionId"],
        message: "An approved stack exception requires a confirmation Decision",
      });
    }
  });

export const technicalModuleSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(240),
    responsibilities: z.array(z.string().trim().min(1).max(1000)).min(1),
    dependsOn: z.array(idSchema),
  })
  .strict();

export const dataEntitySchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(1).max(1000),
    sensitiveData: z.boolean(),
    lifecycle: z.string().trim().min(1).max(1000),
  })
  .strict();

export const apiDesignSchema = z
  .object({
    id: idSchema,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().trim().min(1).max(500).startsWith("/"),
    purpose: z.string().trim().min(1).max(1000),
    authentication: z.enum(["required", "public", "service"]),
    requirementIds: z.array(idSchema).min(1),
  })
  .strict();

export const permissionRuleSchema = z
  .object({
    id: idSchema,
    actor: z.string().trim().min(1).max(240),
    action: z.string().trim().min(1).max(240),
    resource: z.string().trim().min(1).max(240),
    condition: z.string().trim().min(1).max(1000),
  })
  .strict();

export const stateLifecycleSchema = z
  .object({
    entity: z.string().trim().min(1).max(240),
    states: z.array(idSchema).min(1),
    transitions: z
      .array(
        z
          .object({
            from: idSchema,
            to: idSchema,
            trigger: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const traceabilityEntrySchema = z
  .object({
    requirementId: idSchema,
    disposition: z.enum(["designed", "not_applicable"]),
    designItemIds: z.array(idSchema),
    rationale: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disposition === "designed" && value.designItemIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["designItemIds"],
        message: "Designed requirements must reference a design item",
      });
    }
    if (value.disposition === "not_applicable" && !value.rationale) {
      context.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "A not-applicable requirement needs an explicit rationale",
      });
    }
  });

export const technicalDecisionSchema = z
  .object({
    id: idSchema,
    topic: z.string().trim().min(1).max(240),
    choice: z.string().trim().min(1).max(1000),
    rationale: z.string().trim().min(1).max(1000),
    status: z.enum(["accepted_policy", "requires_user_confirmation"]),
  })
  .strict();

export const platformCapabilityReferenceSchema = z
  .object({
    capability: idSchema,
    status: z.enum(["available", "planned", "blocked"]),
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();

const technicalDesignContentFields = {
  architectureSummary: z.string().trim().min(1).max(4000),
  stack: z.array(stackDecisionSchema).min(1),
  modules: z.array(technicalModuleSchema).min(1),
  dataEntities: z.array(dataEntitySchema),
  apis: z.array(apiDesignSchema),
  permissionRules: z.array(permissionRuleSchema).min(1),
  stateLifecycles: z.array(stateLifecycleSchema),
  designItems: z.array(designItemSchema).min(1),
  traceability: z.array(traceabilityEntrySchema).min(1),
  technicalDecisions: z.array(technicalDecisionSchema),
  platformCapabilities: z.array(platformCapabilityReferenceSchema),
  errorHandling: z.array(z.string().trim().min(1).max(1000)).min(1),
  securityConsiderations: z.array(z.string().trim().min(1).max(1000)).min(1),
  privacyConsiderations: z.array(z.string().trim().min(1).max(1000)),
  testStrategy: z.array(z.string().trim().min(1).max(1000)).min(1),
  observability: z.array(z.string().trim().min(1).max(1000)).min(1),
  migrationStrategy: z.string().trim().min(1).max(2000),
  rollbackStrategy: z.string().trim().min(1).max(2000),
  dependencies: z.array(z.string().trim().min(1).max(1000)),
  risks: z.array(z.string().trim().min(1).max(1000)),
} as const;

export const technicalDesignContentSchema = z
  .object(technicalDesignContentFields)
  .strict();

export const technicalDesignRevisionPatchSchema = technicalDesignContentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one Technical Design field is required",
  });

export const technicalDesignVersionSchema = z
  .object({
    ...immutableVersionFields,
    projectSpecVersionId: idSchema,
    projectSpecHash: hashSchema,
    ...technicalDesignContentFields,
    sourceArtifactIds: z.array(idSchema),
    promptVersion: semverSchema,
    modelSnapshot: z.string().trim().min(1).max(240),
  })
  .strict();

export const evidenceTypeSchema = z.enum([
  "test_report",
  "typecheck",
  "lint_report",
  "build_artifact",
  "screenshot",
  "runtime_log",
  "security_report",
  "manual_approval",
]);

export const verificationStepSchema = z
  .object({
    id: idSchema,
    description: z.string().trim().min(1).max(1000),
    evidenceType: evidenceTypeSchema,
    required: z.boolean(),
  })
  .strict();

export const externalOperationSchema = z
  .object({
    kind: z.enum([
      "external_read",
      "external_write",
      "deployment",
      "financial",
      "privileged_access",
    ]),
    riskLevel: z.enum(["medium", "high"]),
    disposition: z.enum([
      "blocked",
      "requires_user_confirmation",
      "approved_with_gate",
    ]),
    rationale: z.string().trim().min(1).max(1000),
    userGateId: idSchema.optional(),
    confirmationDecisionId: idSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disposition === "approved_with_gate") {
      if (!value.userGateId) {
        context.addIssue({
          code: "custom",
          path: ["userGateId"],
          message: "An approved external operation requires a user gate",
        });
      }
      if (!value.confirmationDecisionId) {
        context.addIssue({
          code: "custom",
          path: ["confirmationDecisionId"],
          message: "An approved external operation requires a confirmation Decision",
        });
      }
    }
  });

export const executionTaskSchema = z
  .object({
    id: idSchema,
    phaseId: idSchema,
    title: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(2000),
    dependsOn: z.array(idSchema),
    inputs: z.array(z.string().trim().min(1).max(1000)).min(1),
    outputs: z.array(z.string().trim().min(1).max(1000)).min(1),
    requirementIds: z.array(idSchema).min(1),
    acceptanceCriterionIds: z.array(idSchema).min(1),
    designItemIds: z.array(idSchema).min(1),
    completionCriteria: z.array(z.string().trim().min(1).max(1000)).min(1),
    verificationSteps: z.array(verificationStepSchema).min(1),
    repairStrategy: z.string().trim().min(1).max(1000),
    rollbackStrategy: z.string().trim().min(1).max(1000),
    riskLevel: z.enum(["low", "medium", "high"]),
    externalOperation: externalOperationSchema.optional(),
  })
  .strict();

export const userGateSchema = z
  .object({
    id: idSchema,
    afterPhaseId: idSchema,
    title: z.string().trim().min(1).max(240),
    reason: z.string().trim().min(1).max(1000),
    requiredEvidenceTypes: z.array(evidenceTypeSchema).min(1),
  })
  .strict();

export const executionPhaseSchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(240),
    objective: z.string().trim().min(1).max(1000),
    dependsOnPhaseIds: z.array(idSchema),
    taskIds: z.array(idSchema).min(1),
    verificationStrategy: z.array(z.string().trim().min(1).max(1000)).min(1),
    evidenceTypes: z.array(evidenceTypeSchema).min(1),
    exitCriteria: z.array(z.string().trim().min(1).max(1000)).min(1),
  })
  .strict();

export const coverageWaiverSchema = z
  .object({
    targetType: z.enum(["requirement", "acceptance_criterion"]),
    targetId: idSchema,
    rationale: z.string().trim().min(1).max(1000),
    approvedDecisionId: idSchema,
  })
  .strict();

const executionPlanContentFields = {
  summary: z.string().trim().min(1).max(2000),
  phases: z.array(executionPhaseSchema).min(1),
  tasks: z.array(executionTaskSchema).min(1),
  coverageWaivers: z.array(coverageWaiverSchema),
  userGates: z.array(userGateSchema),
  globalVerificationStrategy: z
    .array(z.string().trim().min(1).max(1000))
    .min(1),
  rollbackStrategy: z.string().trim().min(1).max(2000),
  risks: z.array(z.string().trim().min(1).max(1000)),
} as const;

export const executionPlanContentSchema = z
  .object(executionPlanContentFields)
  .strict();

export const executionPlanRevisionPatchSchema = executionPlanContentSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one Execution Plan field is required",
  });

export const executionPlanVersionSchema = z
  .object({
    ...immutableVersionFields,
    projectSpecVersionId: idSchema,
    projectSpecHash: hashSchema,
    technicalDesignVersionId: idSchema,
    technicalDesignHash: hashSchema,
    ...executionPlanContentFields,
    sourceArtifactIds: z.array(idSchema),
    promptVersion: semverSchema,
    modelSnapshot: z.string().trim().min(1).max(240),
  })
  .strict();

export const documentPointerSchema = z
  .object({
    versionId: idSchema,
    version: z.number().int().positive(),
    hash: hashSchema,
    valid: z.boolean(),
  })
  .strict();

export const planningSnapshotV2Schema = z
  .object({
    workspaceId: idSchema,
    projectId: idSchema,
    workflowRunId: idSchema,
    currentStage: planningStageSchema,
    status: planningStatusV2Schema,
    revision: z.number().int().nonnegative(),
    projectSpec: documentPointerSchema.optional(),
    technicalDesign: documentPointerSchema.optional(),
    executionPlan: documentPointerSchema.optional(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const approvalBindingV2Schema = z
  .object({
    approvalId: idSchema,
    projectId: idSchema,
    workflowRunId: idSchema,
    stageRunId: idSchema,
    subjectType: planningSubjectSchema,
    subjectVersionId: idSchema,
    subjectHash: hashSchema,
    approvalPolicyVersion: semverSchema,
    approvedBy: idSchema,
    approvedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const recordDocumentVersionCommandSchema = z
  .object({
    requestId: idSchema,
    subjectType: planningSubjectSchema,
    versionId: idSchema,
    version: z.number().int().positive(),
    subjectHash: hashSchema,
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const approvePlanningSubjectCommandSchema = z
  .object({
    requestId: idSchema,
    approvalId: idSchema,
    actorId: idSchema,
    stageRunId: idSchema,
    subjectType: planningSubjectSchema,
    subjectVersionId: idSchema,
    subjectHash: hashSchema,
    approvalPolicyVersion: semverSchema,
    approvedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const returnToPlanningSubjectCommandSchema = z
  .object({
    requestId: idSchema,
    actorId: idSchema,
    subjectType: planningSubjectSchema,
    feedback: z.string().trim().min(1).max(4000),
    returnedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const rejectProjectSpecCommandSchema = z
  .object({
    requestId: idSchema,
    actorId: idSchema,
    reason: z.string().trim().min(1).max(4000),
    rejectedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const planningCommandReasonSchema = z.enum([
  "accepted",
  "duplicate",
  "subject_mismatch",
  "not_awaiting_approval",
  "policy_mismatch",
  "version_not_monotonic",
  "invalid_stage",
  "missing_upstream_approval",
  "upstream_binding_mismatch",
]);

export const planningCommandResultSchema = z
  .object({
    requestId: idSchema,
    accepted: z.boolean(),
    reason: planningCommandReasonSchema,
    status: planningStatusV2Schema,
    subjectType: planningSubjectSchema,
    subjectVersionId: idSchema.optional(),
  })
  .strict();

export const invalidationRecordSchema = z
  .object({
    invalidationId: idSchema,
    causedByRequestId: idSchema,
    changedSubjectType: planningSubjectSchema,
    invalidatedSubjectType: planningSubjectSchema,
    invalidatedVersionId: idSchema.optional(),
    invalidatedApprovalId: idSchema.optional(),
    reason: z.enum(["upstream_content_changed", "subject_content_changed"]),
    invalidatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const developmentStartEnvelopeSchema = z
  .object({
    envelopeId: idSchema,
    workspaceId: idSchema,
    projectId: idSchema,
    planningWorkflowRunId: idSchema,
    projectSpecVersionId: idSchema,
    projectSpecHash: hashSchema,
    technicalDesignVersionId: idSchema,
    technicalDesignHash: hashSchema,
    executionPlanVersionId: idSchema,
    executionPlanHash: hashSchema,
    approvalIds: z.array(idSchema).length(3),
    workflowDefinitionVersion: semverSchema,
    workflowDefinitionChecksum: hashSchema,
    validationPolicyVersion: semverSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const planningContractManifestSchema = z
  .object({
    contractVersion: semverSchema,
    sourceRevision: z.string().trim().min(1),
    sourceSchemaHash: hashSchema,
    workflowKey: idSchema,
    workflowVersion: semverSchema,
    definitionChecksum: hashSchema,
    inputSchemaVersion: semverSchema,
    eventSchemaVersion: semverSchema,
    approvalPolicyVersion: semverSchema,
    minimumPlatformCapability: semverSchema,
  })
  .strict();

export type PlanningStage = z.infer<typeof planningStageSchema>;
export type PlanningSubject = z.infer<typeof planningSubjectSchema>;
export type PlanningStatusV2 = z.infer<typeof planningStatusV2Schema>;
export type PlanningWorkflowInputV2 = z.infer<typeof planningWorkflowInputV2Schema>;
export type SupportAssessment = z.infer<typeof supportAssessmentSchema>;
export type PlanningAssumption = z.infer<typeof planningAssumptionSchema>;
export type DiscoveryUncertainty = z.infer<typeof discoveryUncertaintySchema>;
export type RequirementUnderstanding = z.infer<
  typeof requirementUnderstandingSchema
>;
export type ClarificationQuestion = z.infer<typeof clarificationQuestionSchema>;
export type DiscoveryAnalysis = z.infer<typeof discoveryAnalysisSchema>;
export type ClarificationAnswer = z.infer<typeof clarificationAnswerSchema>;
export type DecisionLogEntry = z.infer<typeof decisionLogEntrySchema>;
export type DecisionLog = z.infer<typeof decisionLogSchema>;
export type ProjectSpecContent = z.infer<typeof projectSpecContentSchema>;
export type ProjectSpecRevisionPatch = z.infer<
  typeof projectSpecRevisionPatchSchema
>;
export type ProjectSpecVersion = z.infer<typeof projectSpecVersionSchema>;
export type GoldenStackCapability = z.infer<typeof goldenStackCapabilitySchema>;
export type StackDecision = z.infer<typeof stackDecisionSchema>;
export type TechnicalModule = z.infer<typeof technicalModuleSchema>;
export type DataEntity = z.infer<typeof dataEntitySchema>;
export type ApiDesign = z.infer<typeof apiDesignSchema>;
export type PermissionRule = z.infer<typeof permissionRuleSchema>;
export type StateLifecycle = z.infer<typeof stateLifecycleSchema>;
export type TraceabilityEntry = z.infer<typeof traceabilityEntrySchema>;
export type TechnicalDecision = z.infer<typeof technicalDecisionSchema>;
export type PlatformCapabilityReference = z.infer<
  typeof platformCapabilityReferenceSchema
>;
export type TechnicalDesignContent = z.infer<typeof technicalDesignContentSchema>;
export type TechnicalDesignRevisionPatch = z.infer<
  typeof technicalDesignRevisionPatchSchema
>;
export type TechnicalDesignVersion = z.infer<typeof technicalDesignVersionSchema>;
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type VerificationStep = z.infer<typeof verificationStepSchema>;
export type ExternalOperation = z.infer<typeof externalOperationSchema>;
export type ExecutionTask = z.infer<typeof executionTaskSchema>;
export type UserGate = z.infer<typeof userGateSchema>;
export type ExecutionPhase = z.infer<typeof executionPhaseSchema>;
export type CoverageWaiver = z.infer<typeof coverageWaiverSchema>;
export type ExecutionPlanContent = z.infer<typeof executionPlanContentSchema>;
export type ExecutionPlanRevisionPatch = z.infer<
  typeof executionPlanRevisionPatchSchema
>;
export type ExecutionPlanVersion = z.infer<typeof executionPlanVersionSchema>;
export type PlanningSnapshotV2 = z.infer<typeof planningSnapshotV2Schema>;
export type ApprovalBindingV2 = z.infer<typeof approvalBindingV2Schema>;
export type RecordDocumentVersionCommand = z.infer<
  typeof recordDocumentVersionCommandSchema
>;
export type ApprovePlanningSubjectCommand = z.infer<
  typeof approvePlanningSubjectCommandSchema
>;
export type ReturnToPlanningSubjectCommand = z.infer<
  typeof returnToPlanningSubjectCommandSchema
>;
export type RejectProjectSpecCommand = z.infer<
  typeof rejectProjectSpecCommandSchema
>;
export type PlanningCommandReason = z.infer<typeof planningCommandReasonSchema>;
export type PlanningCommandResult = z.infer<typeof planningCommandResultSchema>;
export type InvalidationRecord = z.infer<typeof invalidationRecordSchema>;
export type DevelopmentStartEnvelope = z.infer<
  typeof developmentStartEnvelopeSchema
>;
export type PlanningContractManifest = z.infer<typeof planningContractManifestSchema>;

export { planningContractManifest } from "./manifest.js";
