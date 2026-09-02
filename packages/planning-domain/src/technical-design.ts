import {
  technicalDesignContentSchema,
  technicalDesignRevisionPatchSchema,
  type GoldenStackCapability,
  type ProjectSpecVersion,
  type TechnicalDesignContent,
  type TechnicalDesignRevisionPatch,
} from "@product-woc/planning-contracts";

export const GOLDEN_STACK = {
  web_framework: "Next.js 16",
  runtime: "Node.js 24",
  language: "TypeScript",
  database: "PostgreSQL/Neon",
  orm: "Drizzle",
  authentication: "Better Auth",
  workflow: "Temporal",
  sandbox: "E2B",
  repository: "GitHub App",
  deployment: "Netlify",
  object_storage: "R2",
} as const satisfies Record<GoldenStackCapability, string>;

const coreCapabilities = new Set<GoldenStackCapability>([
  "web_framework",
  "runtime",
  "language",
  "database",
  "orm",
  "authentication",
  "workflow",
]);

export type TechnicalDesignIssueCode =
  | "duplicate_stack_capability"
  | "missing_stack_capability"
  | "stack_selection_mismatch"
  | "stack_deviation_requires_confirmation"
  | "unconfirmed_stack_exception"
  | "core_stack_not_applicable"
  | "duplicate_requirement_trace"
  | "missing_requirement_trace"
  | "unknown_requirement"
  | "unknown_design_item"
  | "trace_mismatch"
  | "unknown_module"
  | "unknown_module_dependency"
  | "technical_decision_requires_confirmation"
  | "unverified_platform_capability"
  | "secret_material_detected";

export interface TechnicalDesignValidationIssue {
  code: TechnicalDesignIssueCode;
  path: string;
  message: string;
  needsUserAction: boolean;
}

export interface TechnicalDesignValidationResult {
  valid: boolean;
  needsUserAction: boolean;
  issues: readonly TechnicalDesignValidationIssue[];
  requirementCoverage: number;
}

export interface TechnicalDesignPolicyContext {
  availablePlatformCapabilities: readonly string[];
  confirmedDecisionIds?: readonly string[];
}

export function applyTechnicalDesignRevision(
  current: TechnicalDesignContent,
  patch: TechnicalDesignRevisionPatch,
): TechnicalDesignContent {
  const validCurrent = technicalDesignContentSchema.parse(current);
  const validPatch = technicalDesignRevisionPatchSchema.parse(patch);
  return technicalDesignContentSchema.parse({
    ...validCurrent,
    ...validPatch,
  });
}

function issue(
  issues: TechnicalDesignValidationIssue[],
  code: TechnicalDesignIssueCode,
  path: string,
  message: string,
  needsUserAction = false,
): void {
  issues.push({ code, path, message, needsUserAction });
}

export function validateTechnicalDesign(
  content: TechnicalDesignContent,
  projectSpec: ProjectSpecVersion,
  policy: TechnicalDesignPolicyContext,
): TechnicalDesignValidationResult {
  const issues: TechnicalDesignValidationIssue[] = [];
  const confirmedDecisionIds = new Set(policy.confirmedDecisionIds ?? []);
  const stackByCapability = new Map<GoldenStackCapability, (typeof content.stack)[number]>();

  for (const [index, decision] of content.stack.entries()) {
    if (stackByCapability.has(decision.capability)) {
      issue(
        issues,
        "duplicate_stack_capability",
        `stack.${index}.capability`,
        `Duplicate stack capability: ${decision.capability}`,
      );
      continue;
    }
    stackByCapability.set(decision.capability, decision);
    if (
      decision.status === "compliant" &&
      decision.selection !== GOLDEN_STACK[decision.capability]
    ) {
      issue(
        issues,
        "stack_selection_mismatch",
        `stack.${index}.selection`,
        `${decision.capability} must use ${GOLDEN_STACK[decision.capability]}`,
      );
    }
    if (decision.status === "requires_confirmation") {
      issue(
        issues,
        "stack_deviation_requires_confirmation",
        `stack.${index}`,
        `${decision.capability} proposes ${decision.proposedAlternative}`,
        true,
      );
    }
    if (
      decision.status === "approved_exception" &&
      (!decision.confirmationDecisionId ||
        !confirmedDecisionIds.has(decision.confirmationDecisionId))
    ) {
      issue(
        issues,
        "unconfirmed_stack_exception",
        `stack.${index}.confirmationDecisionId`,
        `${decision.capability} does not reference a confirmed Decision`,
        true,
      );
    }
    if (decision.status === "not_applicable" && coreCapabilities.has(decision.capability)) {
      issue(
        issues,
        "core_stack_not_applicable",
        `stack.${index}.status`,
        `${decision.capability} is required by the platform baseline`,
      );
    }
  }

  for (const capability of Object.keys(GOLDEN_STACK) as GoldenStackCapability[]) {
    if (!stackByCapability.has(capability)) {
      issue(
        issues,
        "missing_stack_capability",
        "stack",
        `Missing stack decision for ${capability}`,
      );
    }
  }

  const requirementIds = new Set(projectSpec.requirements.map(({ id }) => id));
  const designItems = new Map(content.designItems.map((item) => [item.id, item]));
  const tracedRequirements = new Set<string>();
  for (const [index, entry] of content.traceability.entries()) {
    if (!requirementIds.has(entry.requirementId)) {
      issue(
        issues,
        "unknown_requirement",
        `traceability.${index}.requirementId`,
        `Unknown requirement: ${entry.requirementId}`,
      );
    }
    if (tracedRequirements.has(entry.requirementId)) {
      issue(
        issues,
        "duplicate_requirement_trace",
        `traceability.${index}.requirementId`,
        `Requirement is traced more than once: ${entry.requirementId}`,
      );
    }
    tracedRequirements.add(entry.requirementId);
    for (const designItemId of entry.designItemIds) {
      const designItem = designItems.get(designItemId);
      if (!designItem) {
        issue(
          issues,
          "unknown_design_item",
          `traceability.${index}.designItemIds`,
          `Unknown design item: ${designItemId}`,
        );
      } else if (!designItem.requirementIds.includes(entry.requirementId)) {
        issue(
          issues,
          "trace_mismatch",
          `traceability.${index}`,
          `${designItemId} does not reference ${entry.requirementId}`,
        );
      }
    }
  }

  for (const requirementId of requirementIds) {
    if (!tracedRequirements.has(requirementId)) {
      issue(
        issues,
        "missing_requirement_trace",
        "traceability",
        `Missing trace for ${requirementId}`,
      );
    }
  }
  for (const [index, item] of content.designItems.entries()) {
    for (const requirementId of item.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        issue(
          issues,
          "unknown_requirement",
          `designItems.${index}.requirementIds`,
          `Unknown requirement: ${requirementId}`,
        );
      }
    }
  }

  const moduleIds = new Set(content.modules.map(({ id }) => id));
  for (const [index, module] of content.modules.entries()) {
    for (const dependencyId of module.dependsOn) {
      if (!moduleIds.has(dependencyId)) {
        issue(
          issues,
          "unknown_module_dependency",
          `modules.${index}.dependsOn`,
          `Unknown module dependency: ${dependencyId}`,
        );
      }
    }
  }
  for (const [index, item] of content.designItems.entries()) {
    for (const moduleId of item.moduleIds) {
      if (!moduleIds.has(moduleId)) {
        issue(
          issues,
          "unknown_module",
          `designItems.${index}.moduleIds`,
          `Unknown module: ${moduleId}`,
        );
      }
    }
  }

  for (const [index, decision] of content.technicalDecisions.entries()) {
    if (decision.status === "requires_user_confirmation") {
      issue(
        issues,
        "technical_decision_requires_confirmation",
        `technicalDecisions.${index}`,
        `Technical decision requires confirmation: ${decision.topic}`,
        true,
      );
    }
  }

  const availableCapabilities = new Set(policy.availablePlatformCapabilities);
  for (const [index, reference] of content.platformCapabilities.entries()) {
    if (
      reference.status === "available" &&
      !availableCapabilities.has(reference.capability)
    ) {
      issue(
        issues,
        "unverified_platform_capability",
        `platformCapabilities.${index}`,
        `Platform capability is not verified as available: ${reference.capability}`,
      );
    }
  }

  const serialized = JSON.stringify(content);
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
    /\b(?:password|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/i,
  ];
  if (secretPatterns.some((pattern) => pattern.test(serialized))) {
    issue(
      issues,
      "secret_material_detected",
      "root",
      "Technical Design contains secret-like material",
    );
  }

  const coveredRequirements = [...requirementIds].filter((id) =>
    tracedRequirements.has(id),
  ).length;
  return {
    valid: issues.length === 0,
    needsUserAction: issues.some(({ needsUserAction }) => needsUserAction),
    issues,
    requirementCoverage:
      requirementIds.size === 0 ? 1 : coveredRequirements / requirementIds.size,
  };
}
