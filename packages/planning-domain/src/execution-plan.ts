import {
  executionPlanContentSchema,
  executionPlanRevisionPatchSchema,
  type ExecutionPlanContent,
  type ExecutionPlanRevisionPatch,
  type ProjectSpecVersion,
  type TechnicalDesignVersion,
} from "@product-woc/planning-contracts";

export type ExecutionPlanIssueCode =
  | "upstream_binding_mismatch"
  | "duplicate_phase"
  | "duplicate_task"
  | "unknown_phase"
  | "unknown_phase_dependency"
  | "phase_cycle"
  | "unknown_task"
  | "orphan_task"
  | "task_phase_mismatch"
  | "unknown_task_dependency"
  | "self_dependency"
  | "task_cycle"
  | "impossible_task_order"
  | "unreachable_task"
  | "unknown_requirement"
  | "unknown_acceptance_criterion"
  | "acceptance_requirement_mismatch"
  | "unknown_design_item"
  | "missing_requirement_coverage"
  | "missing_acceptance_coverage"
  | "invalid_coverage_waiver"
  | "unknown_user_gate"
  | "blocked_external_operation"
  | "external_operation_requires_confirmation"
  | "unconfirmed_external_operation"
  | "secret_material_detected";

export interface ExecutionPlanValidationIssue {
  code: ExecutionPlanIssueCode;
  path: string;
  message: string;
  needsUserAction: boolean;
}

export interface ExecutionPlanValidationResult {
  valid: boolean;
  needsUserAction: boolean;
  issues: readonly ExecutionPlanValidationIssue[];
  requirementCoverage: number;
  acceptanceCriterionCoverage: number;
  reachableTaskCoverage: number;
}

export interface ExecutionPlanPolicyContext {
  confirmedDecisionIds: readonly string[];
}

function issue(
  issues: ExecutionPlanValidationIssue[],
  code: ExecutionPlanIssueCode,
  path: string,
  message: string,
  needsUserAction = false,
): void {
  issues.push({ code, path, message, needsUserAction });
}

function duplicateIds(items: readonly { id: string }[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return duplicates;
}

function cyclicNodes(
  ids: readonly string[],
  dependenciesFor: (id: string) => readonly string[],
): ReadonlySet<string> {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();

  function visit(id: string, path: readonly string[]): void {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      for (const cycleId of path.slice(cycleStart)) {
        cycles.add(cycleId);
      }
      cycles.add(id);
      return;
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    for (const dependency of dependenciesFor(id)) {
      if (ids.includes(dependency)) {
        visit(dependency, [...path, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of ids) {
    visit(id, []);
  }
  return cycles;
}

function reachableTasks(
  content: ExecutionPlanContent,
  knownTaskIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const dependents = new Map<string, string[]>();
  for (const task of content.tasks) {
    for (const dependencyId of task.dependsOn) {
      const existing = dependents.get(dependencyId) ?? [];
      existing.push(task.id);
      dependents.set(dependencyId, existing);
    }
  }

  const reachable = new Set(
    content.tasks.filter(({ dependsOn }) => dependsOn.length === 0).map(({ id }) => id),
  );
  const queue = [...reachable];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependents.get(current) ?? []) {
      const task = content.tasks.find(({ id }) => id === dependent);
      if (
        task &&
        task.dependsOn.every(
          (dependencyId) =>
            !knownTaskIds.has(dependencyId) || reachable.has(dependencyId),
        ) &&
        !reachable.has(dependent)
      ) {
        reachable.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return reachable;
}

export function applyExecutionPlanRevision(
  current: ExecutionPlanContent,
  patch: ExecutionPlanRevisionPatch,
): ExecutionPlanContent {
  const validCurrent = executionPlanContentSchema.parse(current);
  const validPatch = executionPlanRevisionPatchSchema.parse(patch);
  return executionPlanContentSchema.parse({ ...validCurrent, ...validPatch });
}

export function validateExecutionPlan(
  content: ExecutionPlanContent,
  projectSpec: ProjectSpecVersion,
  technicalDesign: TechnicalDesignVersion,
  policy: ExecutionPlanPolicyContext,
): ExecutionPlanValidationResult {
  const issues: ExecutionPlanValidationIssue[] = [];
  if (
    technicalDesign.projectSpecVersionId !== projectSpec.versionId ||
    technicalDesign.projectSpecHash !== projectSpec.normalizedContentHash
  ) {
    issue(
      issues,
      "upstream_binding_mismatch",
      "technicalDesign",
      "Technical Design is not bound to the supplied Project Spec",
    );
  }

  const phaseIds = new Set(content.phases.map(({ id }) => id));
  const taskIds = new Set(content.tasks.map(({ id }) => id));
  for (const id of duplicateIds(content.phases)) {
    issue(issues, "duplicate_phase", "phases", `Duplicate phase: ${id}`);
  }
  for (const id of duplicateIds(content.tasks)) {
    issue(issues, "duplicate_task", "tasks", `Duplicate task: ${id}`);
  }

  const phaseIndex = new Map(content.phases.map(({ id }, index) => [id, index]));
  for (const [index, phase] of content.phases.entries()) {
    for (const dependencyId of phase.dependsOnPhaseIds) {
      if (!phaseIds.has(dependencyId)) {
        issue(
          issues,
          "unknown_phase_dependency",
          `phases.${index}.dependsOnPhaseIds`,
          `Unknown phase dependency: ${dependencyId}`,
        );
      }
    }
    for (const taskId of phase.taskIds) {
      if (!taskIds.has(taskId)) {
        issue(
          issues,
          "unknown_task",
          `phases.${index}.taskIds`,
          `Unknown task: ${taskId}`,
        );
      }
    }
  }
  const phaseCycles = cyclicNodes(
    [...phaseIds],
    (id) => content.phases.find((phase) => phase.id === id)?.dependsOnPhaseIds ?? [],
  );
  for (const id of phaseCycles) {
    issue(issues, "phase_cycle", "phases", `Phase dependency cycle includes ${id}`);
  }

  const taskMembership = new Map<string, string[]>();
  for (const phase of content.phases) {
    for (const taskId of phase.taskIds) {
      const memberships = taskMembership.get(taskId) ?? [];
      memberships.push(phase.id);
      taskMembership.set(taskId, memberships);
    }
  }
  for (const [index, task] of content.tasks.entries()) {
    if (!phaseIds.has(task.phaseId)) {
      issue(
        issues,
        "unknown_phase",
        `tasks.${index}.phaseId`,
        `Unknown phase: ${task.phaseId}`,
      );
    }
    const memberships = taskMembership.get(task.id) ?? [];
    if (memberships.length === 0) {
      issue(issues, "orphan_task", `tasks.${index}`, `Task is not in a phase: ${task.id}`);
    } else if (memberships.length !== 1 || memberships[0] !== task.phaseId) {
      issue(
        issues,
        "task_phase_mismatch",
        `tasks.${index}.phaseId`,
        `Task ${task.id} phase membership does not match ${task.phaseId}`,
      );
    }
    for (const dependencyId of task.dependsOn) {
      if (dependencyId === task.id) {
        issue(
          issues,
          "self_dependency",
          `tasks.${index}.dependsOn`,
          `Task depends on itself: ${task.id}`,
        );
      } else if (!taskIds.has(dependencyId)) {
        issue(
          issues,
          "unknown_task_dependency",
          `tasks.${index}.dependsOn`,
          `Unknown task dependency: ${dependencyId}`,
        );
      } else {
        const dependency = content.tasks.find(({ id }) => id === dependencyId);
        const currentPhase = phaseIndex.get(task.phaseId);
        const dependencyPhase = dependency
          ? phaseIndex.get(dependency.phaseId)
          : undefined;
        if (
          currentPhase !== undefined &&
          dependencyPhase !== undefined &&
          dependencyPhase > currentPhase
        ) {
          issue(
            issues,
            "impossible_task_order",
            `tasks.${index}.dependsOn`,
            `${task.id} depends on a later-phase task ${dependencyId}`,
          );
        }
      }
    }
  }
  const taskCycles = cyclicNodes(
    [...taskIds],
    (id) => content.tasks.find((task) => task.id === id)?.dependsOn ?? [],
  );
  for (const id of taskCycles) {
    issue(issues, "task_cycle", "tasks", `Task dependency cycle includes ${id}`);
  }
  const reachable = reachableTasks(content, taskIds);
  for (const id of taskIds) {
    if (!reachable.has(id)) {
      issue(issues, "unreachable_task", "tasks", `Task is unreachable: ${id}`);
    }
  }

  const requirementIds = new Set(projectSpec.requirements.map(({ id }) => id));
  const acceptanceOwner = new Map<string, string>();
  for (const requirement of projectSpec.requirements) {
    for (const criterion of requirement.acceptanceCriteria) {
      acceptanceOwner.set(criterion.id, requirement.id);
    }
  }
  const designItemIds = new Set(technicalDesign.designItems.map(({ id }) => id));
  const coveredRequirements = new Set<string>();
  const coveredAcceptance = new Set<string>();
  for (const [index, task] of content.tasks.entries()) {
    for (const requirementId of task.requirementIds) {
      if (!requirementIds.has(requirementId)) {
        issue(
          issues,
          "unknown_requirement",
          `tasks.${index}.requirementIds`,
          `Unknown requirement: ${requirementId}`,
        );
      } else {
        coveredRequirements.add(requirementId);
      }
    }
    for (const criterionId of task.acceptanceCriterionIds) {
      const owner = acceptanceOwner.get(criterionId);
      if (!owner) {
        issue(
          issues,
          "unknown_acceptance_criterion",
          `tasks.${index}.acceptanceCriterionIds`,
          `Unknown acceptance criterion: ${criterionId}`,
        );
      } else if (!task.requirementIds.includes(owner)) {
        issue(
          issues,
          "acceptance_requirement_mismatch",
          `tasks.${index}.acceptanceCriterionIds`,
          `${criterionId} belongs to ${owner}, which the task does not reference`,
        );
      } else {
        coveredAcceptance.add(criterionId);
      }
    }
    for (const designItemId of task.designItemIds) {
      if (!designItemIds.has(designItemId)) {
        issue(
          issues,
          "unknown_design_item",
          `tasks.${index}.designItemIds`,
          `Unknown design item: ${designItemId}`,
        );
      }
    }
  }

  const confirmedDecisions = new Set(policy.confirmedDecisionIds);
  const waivedRequirements = new Set<string>();
  const waivedAcceptance = new Set<string>();
  for (const [index, waiver] of content.coverageWaivers.entries()) {
    const knownTarget =
      waiver.targetType === "requirement"
        ? requirementIds.has(waiver.targetId)
        : acceptanceOwner.has(waiver.targetId);
    if (!knownTarget || !confirmedDecisions.has(waiver.approvedDecisionId)) {
      issue(
        issues,
        "invalid_coverage_waiver",
        `coverageWaivers.${index}`,
        `Coverage waiver is unknown or unconfirmed: ${waiver.targetId}`,
        !confirmedDecisions.has(waiver.approvedDecisionId),
      );
    } else if (waiver.targetType === "requirement") {
      waivedRequirements.add(waiver.targetId);
    } else {
      waivedAcceptance.add(waiver.targetId);
    }
  }

  for (const requirementId of requirementIds) {
    if (!coveredRequirements.has(requirementId) && !waivedRequirements.has(requirementId)) {
      issue(
        issues,
        "missing_requirement_coverage",
        "tasks",
        `No task or waiver covers ${requirementId}`,
      );
    }
  }
  for (const criterionId of acceptanceOwner.keys()) {
    if (!coveredAcceptance.has(criterionId) && !waivedAcceptance.has(criterionId)) {
      issue(
        issues,
        "missing_acceptance_coverage",
        "tasks",
        `No task or waiver covers ${criterionId}`,
      );
    }
  }

  const userGateIds = new Set(content.userGates.map(({ id }) => id));
  for (const [index, gate] of content.userGates.entries()) {
    if (!phaseIds.has(gate.afterPhaseId)) {
      issue(
        issues,
        "unknown_phase",
        `userGates.${index}.afterPhaseId`,
        `User gate references unknown phase: ${gate.afterPhaseId}`,
      );
    }
  }
  for (const [index, task] of content.tasks.entries()) {
    const operation = task.externalOperation;
    if (!operation) {
      continue;
    }
    if (operation.disposition === "blocked") {
      issue(
        issues,
        "blocked_external_operation",
        `tasks.${index}.externalOperation`,
        `Blocked external operation cannot be an executable task: ${task.id}`,
      );
    } else if (operation.disposition === "requires_user_confirmation") {
      issue(
        issues,
        "external_operation_requires_confirmation",
        `tasks.${index}.externalOperation`,
        `External operation requires user confirmation: ${task.id}`,
        true,
      );
    } else if (
      !operation.userGateId ||
      !userGateIds.has(operation.userGateId) ||
      !operation.confirmationDecisionId ||
      !confirmedDecisions.has(operation.confirmationDecisionId)
    ) {
      issue(
        issues,
        operation.userGateId && !userGateIds.has(operation.userGateId)
          ? "unknown_user_gate"
          : "unconfirmed_external_operation",
        `tasks.${index}.externalOperation`,
        `Approved external operation lacks a valid gate or Decision: ${task.id}`,
        true,
      );
    }
  }

  const serialized = JSON.stringify(content);
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(serialized) ||
    /\bsk-[A-Za-z0-9_-]{16,}\b/.test(serialized) ||
    /\b(?:password|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/i.test(serialized)
  ) {
    issue(
      issues,
      "secret_material_detected",
      "root",
      "Execution Plan contains secret-like material",
    );
  }

  const coveredRequirementCount = [...requirementIds].filter(
    (id) => coveredRequirements.has(id) || waivedRequirements.has(id),
  ).length;
  const acceptanceIds = [...acceptanceOwner.keys()];
  const coveredAcceptanceCount = acceptanceIds.filter(
    (id) => coveredAcceptance.has(id) || waivedAcceptance.has(id),
  ).length;
  return {
    valid: issues.length === 0,
    needsUserAction: issues.some(({ needsUserAction }) => needsUserAction),
    issues,
    requirementCoverage:
      requirementIds.size === 0 ? 1 : coveredRequirementCount / requirementIds.size,
    acceptanceCriterionCoverage:
      acceptanceIds.length === 0 ? 1 : coveredAcceptanceCount / acceptanceIds.length,
    reachableTaskCoverage: taskIds.size === 0 ? 1 : reachable.size / taskIds.size,
  };
}
