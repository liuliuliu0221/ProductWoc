import { z } from "zod";

import {
  discoveryAnalysisSchema,
  executionPlanContentSchema,
  projectSpecContentSchema,
  technicalDesignContentSchema,
  type DiscoveryAnalysis,
  type ExecutionPlanContent,
  type ProjectSpecContent,
  type ProjectSpecVersion,
  type TechnicalDesignContent,
  type TechnicalDesignVersion,
} from "@product-woc/planning-contracts";
import {
  validateExecutionPlan,
  validateTechnicalDesign,
  type ExecutionPlanPolicyContext,
  type TechnicalDesignPolicyContext,
} from "@product-woc/planning-domain";

export const planningEvalFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    category: z.enum([
      "crud_saas",
      "admin_tool",
      "content",
      "form",
      "light_workflow",
      "vague",
      "unsupported",
      "high_risk",
      "integration",
      "sensitive",
      "reference",
    ]),
    language: z.enum(["zh", "en", "mixed"]),
    idea: z.string().trim().min(3),
    expectedSupportLevel: z.enum(["supported", "needs_user_action", "unsupported"]),
    expectedQuestionTopics: z.array(z.string().trim().min(1)).max(3),
    maxQuestions: z.number().int().min(0).max(3),
    shouldGenerateSpec: z.boolean(),
    expectedDecisions: z.array(z.string().trim().min(1)),
    forbiddenBehaviors: z.array(z.string().trim().min(1)),
    schemaVersion: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    scorerVersion: z.string().trim().min(1).default("2.0.0"),
    referenceContexts: z
      .array(
        z
          .object({
            kind: z.enum(["attachment", "memory", "blueprint"]),
            summary: z.string().trim().min(1).max(4000),
            authoritative: z.literal(false),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type PlanningEvalFixture = z.infer<typeof planningEvalFixtureSchema>;

export interface EvalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PlanningEvalScore {
  fixtureId: string;
  score: number;
  checks: readonly EvalCheck[];
}

export interface PlanningEvalObservation {
  fixture: PlanningEvalFixture;
  discoveryScore: PlanningEvalScore;
  technicalDesignScore?: PlanningEvalScore;
  executionPlanScore?: PlanningEvalScore;
  firstPassSchemaValid: boolean;
  repairAttempts: number;
  requiredUserAction: boolean;
  invalidationValid: boolean;
  referenceOverrideViolations: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
}

export interface PlanningEvalSuiteReport {
  fixtureCount: number;
  languageCoverage: readonly PlanningEvalFixture["language"][];
  categoryCoverage: readonly PlanningEvalFixture["category"][];
  meanScore: number;
  firstPassSchemaRate: number;
  repairRate: number;
  humanActionRate: number;
  invalidationAccuracy: number;
  unsupportedDetectionRate: number;
  referenceOverrideViolations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  gatePassed: boolean;
}

function rate(count: number, total: number): number {
  return total === 0 ? 1 : count / total;
}

export function scorePlanningFixture(
  fixture: PlanningEvalFixture,
  analysis: DiscoveryAnalysis,
  projectSpec?: ProjectSpecContent,
): PlanningEvalScore {
  const parsedFixture = planningEvalFixtureSchema.parse(fixture);
  const parsedAnalysis = discoveryAnalysisSchema.safeParse(analysis);
  const actualTopics = analysis.questions.map(({ topic }) => topic);
  const checks: EvalCheck[] = [
    {
      name: "discovery_schema",
      passed: parsedAnalysis.success,
      detail: parsedAnalysis.success ? "valid" : "invalid",
    },
    {
      name: "support_level",
      passed:
        analysis.understanding.support.level === parsedFixture.expectedSupportLevel,
      detail: `${analysis.understanding.support.level} / ${parsedFixture.expectedSupportLevel}`,
    },
    {
      name: "question_limit",
      passed:
        analysis.questions.length <= parsedFixture.maxQuestions &&
        analysis.questions.length <= 3,
      detail: `${analysis.questions.length} / ${parsedFixture.maxQuestions}`,
    },
    {
      name: "question_topics",
      passed: parsedFixture.expectedQuestionTopics.every((topic) =>
        actualTopics.includes(topic),
      ),
      detail: actualTopics.join(", "),
    },
    {
      name: "project_spec_gate",
      passed: parsedFixture.shouldGenerateSpec
        ? projectSpecContentSchema.safeParse(projectSpec).success
        : projectSpec === undefined,
      detail: parsedFixture.shouldGenerateSpec
        ? projectSpec
          ? "candidate supplied"
          : "candidate missing"
        : projectSpec
          ? "unexpected candidate"
          : "correctly blocked",
    },
    {
      name: "mvp_boundary",
      passed: parsedFixture.shouldGenerateSpec
        ? (projectSpec?.inScope.length ?? 0) > 0 &&
          (projectSpec?.outOfScope.length ?? 0) > 0
        : true,
      detail: projectSpec
        ? `${projectSpec.inScope.length} in / ${projectSpec.outOfScope.length} out`
        : "blocked before spec",
    },
    {
      name: "assumptions_and_risks",
      passed: parsedFixture.shouldGenerateSpec
        ? (projectSpec?.assumptions.length ?? 0) > 0 &&
          (projectSpec?.risks.length ?? 0) > 0
        : analysis.understanding.risks.length > 0,
      detail: `${projectSpec?.assumptions.length ?? analysis.understanding.assumptions.length} assumptions / ${projectSpec?.risks.length ?? analysis.understanding.risks.length} risks`,
    },
    {
      name: "expected_decisions",
      passed: parsedFixture.shouldGenerateSpec
        ? parsedFixture.expectedDecisions.every((decision) =>
            projectSpec?.assumptions.includes(decision),
          )
        : parsedFixture.expectedDecisions.every((decision) =>
            analysis.understanding.assumptions.some(
              ({ statement }) => statement === decision,
            ),
          ),
      detail: parsedFixture.expectedDecisions.join(", "),
    },
    {
      name: "forbidden_behavior_boundary",
      passed:
        projectSpec === undefined ||
        parsedFixture.forbiddenBehaviors.every(
          (behavior) => !projectSpec.inScope.includes(behavior),
        ),
      detail: "forbidden behavior absent from MVP scope",
    },
  ];

  return {
    fixtureId: parsedFixture.id,
    score: checks.filter(({ passed }) => passed).length / checks.length,
    checks,
  };
}

export function summarizePlanningEvalSuite(
  observations: readonly PlanningEvalObservation[],
): PlanningEvalSuiteReport {
  const scores = observations.flatMap((observation) => [
    observation.discoveryScore.score,
    ...(observation.technicalDesignScore
      ? [observation.technicalDesignScore.score]
      : []),
    ...(observation.executionPlanScore
      ? [observation.executionPlanScore.score]
      : []),
  ]);
  const unsupported = observations.filter(
    ({ fixture }) => fixture.expectedSupportLevel !== "supported",
  );
  const unsupportedDetected = unsupported.filter(({ discoveryScore }) =>
    discoveryScore.checks
      .filter(({ name }) => name === "support_level")
      .every(({ passed }) => passed),
  ).length;
  const report: PlanningEvalSuiteReport = {
    fixtureCount: observations.length,
    languageCoverage: [
      ...new Set(observations.map(({ fixture }) => fixture.language)),
    ].sort(),
    categoryCoverage: [
      ...new Set(observations.map(({ fixture }) => fixture.category)),
    ].sort(),
    meanScore: rate(
      scores.reduce((total, score) => total + score, 0),
      scores.length,
    ),
    firstPassSchemaRate: rate(
      observations.filter(({ firstPassSchemaValid }) => firstPassSchemaValid)
        .length,
      observations.length,
    ),
    repairRate: rate(
      observations.filter(({ repairAttempts }) => repairAttempts > 0).length,
      observations.length,
    ),
    humanActionRate: rate(
      observations.filter(({ requiredUserAction }) => requiredUserAction).length,
      observations.length,
    ),
    invalidationAccuracy: rate(
      observations.filter(({ invalidationValid }) => invalidationValid).length,
      observations.length,
    ),
    unsupportedDetectionRate: rate(unsupportedDetected, unsupported.length),
    referenceOverrideViolations: observations.reduce(
      (total, { referenceOverrideViolations }) =>
        total + referenceOverrideViolations,
      0,
    ),
    totalInputTokens: observations.reduce(
      (total, { inputTokens }) => total + inputTokens,
      0,
    ),
    totalOutputTokens: observations.reduce(
      (total, { outputTokens }) => total + outputTokens,
      0,
    ),
    totalLatencyMs: observations.reduce(
      (total, { latencyMs }) => total + latencyMs,
      0,
    ),
    totalCostUsd: observations.reduce(
      (total, { costUsd }) => total + costUsd,
      0,
    ),
    gatePassed: false,
  };
  report.gatePassed =
    report.fixtureCount >= 20 &&
    report.languageCoverage.length === 3 &&
    report.meanScore === 1 &&
    report.invalidationAccuracy === 1 &&
    report.unsupportedDetectionRate === 1 &&
    report.referenceOverrideViolations === 0;
  return report;
}

export function scoreTechnicalDesign(
  fixtureId: string,
  projectSpec: ProjectSpecVersion,
  technicalDesign: TechnicalDesignContent,
  policy: TechnicalDesignPolicyContext,
): PlanningEvalScore {
  const schemaResult = technicalDesignContentSchema.safeParse(technicalDesign);
  const validation = schemaResult.success
    ? validateTechnicalDesign(schemaResult.data, projectSpec, policy)
    : undefined;
  const checks: EvalCheck[] = [
    {
      name: "technical_design_schema",
      passed: schemaResult.success,
      detail: schemaResult.success ? "valid" : "invalid",
    },
    {
      name: "architecture_boundary",
      passed:
        technicalDesign.architectureSummary.length > 0 &&
        technicalDesign.modules.length > 0,
      detail: `${technicalDesign.modules.length} modules`,
    },
    {
      name: "requirement_coverage",
      passed: validation?.requirementCoverage === 1,
      detail: `${validation?.requirementCoverage ?? 0}`,
    },
    {
      name: "golden_stack_policy",
      passed: validation?.valid === true && validation.needsUserAction === false,
      detail: validation?.issues.map(({ code }) => code).join(", ") ?? "schema invalid",
    },
    {
      name: "security_boundary",
      passed:
        technicalDesign.securityConsiderations.length > 0 &&
        technicalDesign.permissionRules.length > 0,
      detail: `${technicalDesign.securityConsiderations.length} controls`,
    },
    {
      name: "data_boundary",
      passed: technicalDesign.dataEntities.every(
        ({ lifecycle, purpose }) => lifecycle.length > 0 && purpose.length > 0,
      ),
      detail: `${technicalDesign.dataEntities.length} entities`,
    },
  ];

  return {
    fixtureId,
    score: checks.filter(({ passed }) => passed).length / checks.length,
    checks,
  };
}

export function scoreExecutionPlan(
  fixtureId: string,
  projectSpec: ProjectSpecVersion,
  technicalDesign: TechnicalDesignVersion,
  executionPlan: ExecutionPlanContent,
  policy: ExecutionPlanPolicyContext,
): PlanningEvalScore {
  const schemaResult = executionPlanContentSchema.safeParse(executionPlan);
  const validation = schemaResult.success
    ? validateExecutionPlan(
        schemaResult.data,
        projectSpec,
        technicalDesign,
        policy,
      )
    : undefined;
  const graphIssueCodes = new Set([
    "phase_cycle",
    "task_cycle",
    "unreachable_task",
    "unknown_task_dependency",
    "impossible_task_order",
  ]);
  const riskIssueCodes = new Set([
    "blocked_external_operation",
    "external_operation_requires_confirmation",
    "unconfirmed_external_operation",
    "unknown_user_gate",
  ]);
  const checks: EvalCheck[] = [
    {
      name: "execution_plan_schema",
      passed: schemaResult.success,
      detail: schemaResult.success ? "valid" : "invalid",
    },
    {
      name: "dependency_graph",
      passed:
        validation?.reachableTaskCoverage === 1 &&
        !validation.issues.some(({ code }) => graphIssueCodes.has(code)),
      detail: `${validation?.reachableTaskCoverage ?? 0} reachable`,
    },
    {
      name: "requirement_coverage",
      passed: validation?.requirementCoverage === 1,
      detail: `${validation?.requirementCoverage ?? 0}`,
    },
    {
      name: "acceptance_criterion_coverage",
      passed: validation?.acceptanceCriterionCoverage === 1,
      detail: `${validation?.acceptanceCriterionCoverage ?? 0}`,
    },
    {
      name: "verification_evidence",
      passed:
        executionPlan.phases.every(
          ({ verificationStrategy, evidenceTypes, exitCriteria }) =>
            verificationStrategy.length > 0 &&
            evidenceTypes.length > 0 &&
            exitCriteria.length > 0,
        ) &&
        executionPlan.tasks.every(
          ({ completionCriteria, verificationSteps }) =>
            completionCriteria.length > 0 &&
            verificationSteps.some(({ required }) => required),
        ),
      detail: `${executionPlan.tasks.length} tasks with verification`,
    },
    {
      name: "risk_gates",
      passed:
        validation !== undefined &&
        !validation.issues.some(({ code }) => riskIssueCodes.has(code)),
      detail:
        validation?.issues
          .filter(({ code }) => riskIssueCodes.has(code))
          .map(({ code }) => code)
          .join(", ") || "valid",
    },
  ];

  return {
    fixtureId,
    score: checks.filter(({ passed }) => passed).length / checks.length,
    checks,
  };
}
