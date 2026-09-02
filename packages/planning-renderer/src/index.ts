import type {
  ExecutionPlanVersion,
  ProjectSpecVersion,
  TechnicalDesignVersion,
} from "@product-woc/planning-contracts";

export * from "./diff.js";

function section(title: string, items: readonly string[]): string {
  const body = items.length === 0 ? "- None" : items.map((item) => `- ${item}`).join("\n");
  return `## ${title}\n\n${body}`;
}

export function renderProjectSpecMarkdown(spec: ProjectSpecVersion): string {
  const requirements = spec.requirements.map(
    (requirement) =>
      `### ${requirement.id}: ${requirement.title}\n\n${requirement.description}\n\n${requirement.acceptanceCriteria
        .map((criterion) => `- ${criterion.id}: ${criterion.description}`)
        .join("\n")}`,
  );

  return [
    `# ${spec.title}`,
    spec.summary,
    section("Target users", spec.targetUsers),
    section("MVP scope", spec.inScope),
    section("Out of scope", spec.outOfScope),
    `## Requirements\n\n${requirements.join("\n\n")}`,
    section("Assumptions", spec.assumptions),
    section("Risks", spec.risks),
  ].join("\n\n");
}

export interface ProjectSpecDecisionSummary {
  title: string;
  goal: string;
  targetUsers: readonly string[];
  inScope: readonly string[];
  outOfScope: readonly string[];
  assumptions: readonly string[];
  risks: readonly string[];
  openQuestions: readonly string[];
}

export function summarizeProjectSpec(
  spec: ProjectSpecVersion,
): ProjectSpecDecisionSummary {
  return {
    title: spec.title,
    goal: spec.summary,
    targetUsers: spec.targetUsers,
    inScope: spec.inScope,
    outOfScope: spec.outOfScope,
    assumptions: spec.assumptions,
    risks: spec.risks,
    openQuestions: spec.openQuestions,
  };
}

function renderStack(design: TechnicalDesignVersion): string {
  return design.stack
    .map(
      (item) =>
        `- ${item.capability}: ${item.selection} (${item.status}) — ${item.rationale}`,
    )
    .join("\n");
}

export function renderTechnicalDesignMarkdown(
  design: TechnicalDesignVersion,
): string {
  const modules = design.modules
    .map(
      (module) =>
        `### ${module.id}: ${module.name}\n\n${module.responsibilities
          .map((responsibility) => `- ${responsibility}`)
          .join("\n")}\n\nDepends on: ${module.dependsOn.join(", ") || "None"}`,
    )
    .join("\n\n");
  const traceability = design.traceability
    .map(
      (entry) =>
        `- ${entry.requirementId}: ${entry.disposition} → ${
          entry.designItemIds.join(", ") || entry.rationale || "No design item"
        }`,
    )
    .join("\n");

  return [
    "# Technical Design",
    design.architectureSummary,
    `Bound Project Spec: ${design.projectSpecVersionId} (${design.projectSpecHash})`,
    `## Golden stack\n\n${renderStack(design)}`,
    `## Modules\n\n${modules}`,
    `## Requirement traceability\n\n${traceability}`,
    section("Security", design.securityConsiderations),
    section("Privacy", design.privacyConsiderations),
    section("Testing", design.testStrategy),
    section("Observability", design.observability),
    `## Migration\n\n${design.migrationStrategy}`,
    `## Rollback\n\n${design.rollbackStrategy}`,
    section("Risks", design.risks),
  ].join("\n\n");
}

export interface TechnicalDesignDecisionSummary {
  architecture: string;
  modules: readonly string[];
  stackExceptions: readonly string[];
  decisionsRequiringConfirmation: readonly string[];
  securityHighlights: readonly string[];
  risks: readonly string[];
}

export function summarizeTechnicalDesign(
  design: TechnicalDesignVersion,
): TechnicalDesignDecisionSummary {
  return {
    architecture: design.architectureSummary,
    modules: design.modules.map(({ name }) => name),
    stackExceptions: design.stack
      .filter(({ status }) =>
        ["requires_confirmation", "approved_exception"].includes(status),
      )
      .map(({ capability, proposedAlternative, selection }) =>
        `${capability}: ${proposedAlternative ?? selection}`,
      ),
    decisionsRequiringConfirmation: design.technicalDecisions
      .filter(({ status }) => status === "requires_user_confirmation")
      .map(({ topic }) => topic),
    securityHighlights: design.securityConsiderations,
    risks: design.risks,
  };
}

function renderExecutionTask(
  task: ExecutionPlanVersion["tasks"][number],
): string {
  const verification = task.verificationSteps
    .map(
      (step) =>
        `- ${step.id}: ${step.description} [${step.evidenceType}]${
          step.required ? " (required)" : ""
        }`,
    )
    .join("\n");
  const externalOperation = task.externalOperation
    ? `\n\nExternal operation: ${task.externalOperation.kind} / ${task.externalOperation.disposition} — ${task.externalOperation.rationale}`
    : "";

  return [
    `### ${task.id}: ${task.title}`,
    task.description,
    `Depends on: ${task.dependsOn.join(", ") || "None"}`,
    `Traceability: requirements ${task.requirementIds.join(", ")}; acceptance criteria ${task.acceptanceCriterionIds.join(", ")}; design items ${task.designItemIds.join(", ")}`,
    `Completion criteria:\n${task.completionCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Verification:\n${verification}`,
    `Risk: ${task.riskLevel}`,
    `Repair: ${task.repairStrategy}`,
    `Rollback: ${task.rollbackStrategy}${externalOperation}`,
  ].join("\n\n");
}

export function renderExecutionPlanMarkdown(plan: ExecutionPlanVersion): string {
  const phases = plan.phases
    .map(
      (phase) =>
        `### ${phase.id}: ${phase.title}\n\n${phase.objective}\n\nDepends on phases: ${
          phase.dependsOnPhaseIds.join(", ") || "None"
        }\n\nTasks: ${phase.taskIds.join(", ")}\n\nExit criteria:\n${phase.exitCriteria
          .map((item) => `- ${item}`)
          .join("\n")}\n\nEvidence: ${phase.evidenceTypes.join(", ")}`,
    )
    .join("\n\n");
  const gates = plan.userGates.map(
    (gate) =>
      `${gate.id}: after ${gate.afterPhaseId} — ${gate.title}; evidence ${gate.requiredEvidenceTypes.join(", ")}`,
  );
  const waivers = plan.coverageWaivers.map(
    (waiver) =>
      `${waiver.targetType} ${waiver.targetId}: ${waiver.rationale} (${waiver.approvedDecisionId})`,
  );

  return [
    "# Execution Plan",
    plan.summary,
    `Bound Project Spec: ${plan.projectSpecVersionId} (${plan.projectSpecHash})`,
    `Bound Technical Design: ${plan.technicalDesignVersionId} (${plan.technicalDesignHash})`,
    `## Phases\n\n${phases}`,
    `## Tasks\n\n${plan.tasks.map(renderExecutionTask).join("\n\n")}`,
    section("Global verification", plan.globalVerificationStrategy),
    section("User gates", gates),
    section("Coverage waivers", waivers),
    `## Rollback\n\n${plan.rollbackStrategy}`,
    section("Risks", plan.risks),
  ].join("\n\n");
}

export interface ExecutionPlanDecisionSummary {
  summary: string;
  phaseCount: number;
  phases: readonly string[];
  taskCount: number;
  highRiskTasks: readonly string[];
  userGates: readonly string[];
  risks: readonly string[];
}

export function summarizeExecutionPlan(
  plan: ExecutionPlanVersion,
): ExecutionPlanDecisionSummary {
  return {
    summary: plan.summary,
    phaseCount: plan.phases.length,
    phases: plan.phases.map(({ title }) => title),
    taskCount: plan.tasks.length,
    highRiskTasks: plan.tasks
      .filter(({ riskLevel }) => riskLevel === "high")
      .map(({ title }) => title),
    userGates: plan.userGates.map(({ title }) => title),
    risks: plan.risks,
  };
}
