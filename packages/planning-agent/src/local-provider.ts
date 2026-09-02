import {
  executionPlanContentSchema,
  projectSpecContentSchema,
  requirementUnderstandingSchema,
  technicalDesignContentSchema,
  type GoldenStackCapability,
  type ProjectSpecContent,
  type RequirementUnderstanding,
  type TechnicalDesignContent,
} from "@product-woc/planning-contracts";

import type {
  PlanningModelProvider,
  PlanningModelRequest,
  PlanningModelResponse,
} from "./index.js";

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Standalone model received an invalid structured context");
  }
  return value as Readonly<Record<string, unknown>>;
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function discoveryOutput(request: PlanningModelRequest): RequirementUnderstanding {
  const idea = textValue(request.input.idea, "Build a private planning workflow");
  return requirementUnderstandingSchema.parse({
    summary: idea,
    targetUsers: ["Workspace members"],
    coreTasks: ["Complete the requested primary workflow"],
    assumptions: [
      {
        id: "ASSUMPTION-1",
        statement: "The first release is a private single-workspace MVP",
        source: "recommended_default",
        overridable: true,
      },
    ],
    risks: ["The generic local model requires human refinement for production use"],
    support: {
      level: "supported",
      reason: "The standalone runtime can plan a private MVP without external services",
    },
    uncertainties: [],
  });
}

function projectSpecOutput(request: PlanningModelRequest): ProjectSpecContent {
  const understanding = requirementUnderstandingSchema.parse(
    request.input.understanding,
  );
  return projectSpecContentSchema.parse({
    title: textValue(request.input.idea, "Standalone product MVP").slice(0, 160),
    summary: understanding.summary,
    targetUsers: understanding.targetUsers,
    coreTasks: understanding.coreTasks,
    successMetrics: ["The primary workflow passes its acceptance test"],
    inScope: ["A private, locally executable primary workflow"],
    outOfScope: ["Public publishing", "Production deployment", "External writes"],
    requirements: [
      {
        id: "REQ-1",
        title: "Primary workflow",
        description: understanding.coreTasks[0],
        acceptanceCriteria: [
          {
            id: "AC-1",
            description:
              "A workspace member can complete the primary workflow and observe a deterministic result",
          },
        ],
        sources: [],
      },
    ],
    assumptions: understanding.assumptions.map(({ statement }) => statement),
    risks: understanding.risks,
    openQuestions: [],
  });
}

interface MinimalRequirement {
  id: string;
  acceptanceCriteria: readonly { id: string }[];
}

function requirementsFrom(value: unknown): readonly MinimalRequirement[] {
  const record = objectValue(value);
  if (!Array.isArray(record.requirements)) {
    throw new Error("Standalone model requires Project Spec requirements");
  }
  return record.requirements.map((requirement) => {
    const item = objectValue(requirement);
    if (typeof item.id !== "string" || !Array.isArray(item.acceptanceCriteria)) {
      throw new Error("Standalone model received an invalid requirement");
    }
    return {
      id: item.id,
      acceptanceCriteria: item.acceptanceCriteria.map((criterion) => {
        const acceptance = objectValue(criterion);
        if (typeof acceptance.id !== "string") {
          throw new Error("Standalone model received an invalid acceptance criterion");
        }
        return { id: acceptance.id };
      }),
    };
  });
}

function technicalDesignOutput(request: PlanningModelRequest): TechnicalDesignContent {
  const requirements = requirementsFrom(request.input.projectSpec);
  const goldenStack = objectValue(request.input.goldenStack);
  const stack = Object.entries(goldenStack).map(([capability, selection]) => ({
    capability: capability as GoldenStackCapability,
    selection: textValue(selection, capability),
    status: "compliant" as const,
    rationale: "Selected by the standalone ProductWoc planning policy",
  }));
  const requirementIds = requirements.map(({ id }) => id);
  const designItems = requirements.map(({ id }, index) => ({
    id: `DES-${index + 1}`,
    title: `Implement ${id}`,
    description: `Implement and verify the behavior defined by ${id}`,
    requirementIds: [id],
    moduleIds: ["MOD-1"],
  }));

  return technicalDesignContentSchema.parse({
    architectureSummary:
      "A standalone modular TypeScript application with explicit domain, workflow, adapter, and presentation boundaries.",
    stack,
    modules: [
      {
        id: "MOD-1",
        name: "Primary workflow module",
        responsibilities: ["Implement the approved private MVP workflow"],
        dependsOn: [],
      },
    ],
    dataEntities: [
      {
        id: "ENTITY-1",
        name: "WorkflowRecord",
        purpose: "Persist the deterministic result of the primary workflow",
        sensitiveData: false,
        lifecycle: "Created locally, updated by the workflow, and retained until explicit deletion",
      },
    ],
    apis: [
      {
        id: "API-1",
        method: "POST",
        path: "/api/workflow",
        purpose: "Execute the primary workflow",
        authentication: "required",
        requirementIds,
      },
    ],
    permissionRules: [
      {
        id: "PERMISSION-1",
        actor: "Workspace member",
        action: "execute",
        resource: "Primary workflow",
        condition: "The member belongs to the active private workspace",
      },
    ],
    stateLifecycles: [
      {
        entity: "WorkflowRecord",
        states: ["draft", "completed"],
        transitions: [
          {
            from: "draft",
            to: "completed",
            trigger: "The validated primary workflow succeeds",
          },
        ],
      },
    ],
    designItems,
    traceability: requirements.map(({ id }, index) => ({
      requirementId: id,
      disposition: "designed" as const,
      designItemIds: [`DES-${index + 1}`],
    })),
    technicalDecisions: [],
    platformCapabilities: [],
    errorHandling: ["Return structured validation errors without exposing internals"],
    securityConsiderations: ["Validate all inputs and keep workspace data private"],
    privacyConsiderations: ["Do not send local planning content to external services"],
    testStrategy: ["Run domain, workflow, and end-to-end tests locally"],
    observability: ["Emit structured in-memory workflow events for inspection"],
    migrationStrategy: "Use additive standalone migrations when persistence is added.",
    rollbackStrategy: "Disable the affected workflow entry point and retain user data.",
    dependencies: [],
    risks: ["The deterministic local provider is a development implementation"],
  });
}

function executionPlanOutput(request: PlanningModelRequest): unknown {
  const requirements = requirementsFrom(request.input.projectSpec);
  const design = objectValue(request.input.technicalDesign);
  if (!Array.isArray(design.designItems)) {
    throw new Error("Standalone model requires Technical Design items");
  }
  const requirementIds = requirements.map(({ id }) => id);
  const acceptanceCriterionIds = requirements.flatMap(({ acceptanceCriteria }) =>
    acceptanceCriteria.map(({ id }) => id),
  );
  const designItemIds = design.designItems.map((item) => {
    const designItem = objectValue(item);
    if (typeof designItem.id !== "string") {
      throw new Error("Standalone model received an invalid Design Item");
    }
    return designItem.id;
  });

  return executionPlanContentSchema.parse({
    summary: "Deliver the approved MVP through two locally verified phases.",
    phases: [
      {
        id: "phase-foundation",
        title: "Foundation",
        objective: "Implement the approved domain and adapter boundaries.",
        dependsOnPhaseIds: [],
        taskIds: ["task-foundation"],
        verificationStrategy: ["Run typecheck and domain tests"],
        evidenceTypes: ["typecheck", "test_report"],
        exitCriteria: ["The foundation compiles and its tests pass"],
      },
      {
        id: "phase-workflow",
        title: "Primary workflow",
        objective: "Implement and verify the accepted end-to-end behavior.",
        dependsOnPhaseIds: ["phase-foundation"],
        taskIds: ["task-workflow"],
        verificationStrategy: ["Run the local end-to-end scenario"],
        evidenceTypes: ["test_report", "runtime_log"],
        exitCriteria: ["All acceptance criteria have passing evidence"],
      },
    ],
    tasks: [
      {
        id: "task-foundation",
        phaseId: "phase-foundation",
        title: "Implement the standalone foundation",
        description: "Create the domain and in-memory adapter implementation.",
        dependsOn: [],
        inputs: ["Approved Project Spec", "Approved Technical Design"],
        outputs: ["Validated standalone foundation"],
        requirementIds,
        acceptanceCriterionIds,
        designItemIds,
        completionCriteria: ["Foundation tests pass"],
        verificationSteps: [
          {
            id: "verify-foundation",
            description: "Run typecheck and foundation tests",
            evidenceType: "test_report",
            required: true,
          },
        ],
        repairStrategy: "Repair the smallest failing boundary and rerun its tests.",
        rollbackStrategy: "Revert the additive foundation change.",
        riskLevel: "low",
      },
      {
        id: "task-workflow",
        phaseId: "phase-workflow",
        title: "Implement the primary workflow",
        description: "Connect the approved behavior and verify it end to end.",
        dependsOn: ["task-foundation"],
        inputs: ["Validated standalone foundation"],
        outputs: ["Working private MVP workflow"],
        requirementIds,
        acceptanceCriterionIds,
        designItemIds,
        completionCriteria: ["The acceptance scenario passes locally"],
        verificationSteps: [
          {
            id: "verify-workflow",
            description: "Run the standalone end-to-end scenario",
            evidenceType: "test_report",
            required: true,
          },
        ],
        repairStrategy: "Repair the failing workflow step and repeat the scenario.",
        rollbackStrategy: "Disable the workflow entry point while preserving local data.",
        riskLevel: "low",
      },
    ],
    coverageWaivers: [],
    userGates: [],
    globalVerificationStrategy: [
      "Run lint, typecheck, unit tests, end-to-end tests, and build locally",
    ],
    rollbackStrategy:
      "Revert additive integration points without deleting local user data.",
    risks: ["Production integrations require separately supplied adapters"],
  });
}

/**
 * Offline deterministic provider for local development and smoke tests.
 * It performs no network calls and is intentionally not a production AI provider.
 */
export class LocalDeterministicPlanningModelProvider
  implements PlanningModelProvider
{
  public async generate(
    request: PlanningModelRequest,
  ): Promise<PlanningModelResponse> {
    const output = request.input.technicalDesign
      ? executionPlanOutput(request)
      : request.input.goldenStack
        ? technicalDesignOutput(request)
        : request.input.understanding
          ? projectSpecOutput(request)
          : discoveryOutput(request);
    return {
      provider: "product-woc-local",
      modelSnapshot: "deterministic-v1",
      output,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    };
  }
}
