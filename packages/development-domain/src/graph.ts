import type {
  ExecutionPlanVersion,
  ExecutionTask,
} from "@product-woc/planning-contracts";

import { contentHash } from "./canonical-json.js";

export type DevelopmentGraphIssueCode =
  | "duplicate_phase"
  | "duplicate_task"
  | "unknown_phase_dependency"
  | "phase_cycle"
  | "unknown_task"
  | "orphan_task"
  | "task_phase_mismatch"
  | "unknown_task_dependency"
  | "self_dependency"
  | "task_cycle"
  | "impossible_task_order"
  | "unknown_user_gate"
  | "duplicate_user_gate";

export interface DevelopmentGraphIssue {
  code: DevelopmentGraphIssueCode;
  path: string;
  message: string;
}

export interface DevelopmentExecutionGraph {
  phaseOrder: readonly string[];
  taskOrder: readonly string[];
  phaseDependencies: Readonly<Record<string, readonly string[]>>;
  taskDependencies: Readonly<Record<string, readonly string[]>>;
  taskPhase: Readonly<Record<string, string>>;
  graphHash: string;
}

export type DevelopmentGraphResult =
  | { valid: true; graph: DevelopmentExecutionGraph; issues: readonly [] }
  | { valid: false; issues: readonly DevelopmentGraphIssue[] };

function duplicates(ids: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      repeated.add(id);
    }
    seen.add(id);
  }
  return repeated;
}

function stableTopologicalOrder(
  ids: readonly string[],
  dependencies: Readonly<Record<string, readonly string[]>>,
): readonly string[] | undefined {
  const knownIds = new Set(ids);
  const completed = new Set<string>();
  const ordered: string[] = [];
  while (ordered.length < ids.length) {
    const next = ids.find(
      (id) =>
        !completed.has(id) &&
        (dependencies[id] ?? []).every(
          (dependency) => !knownIds.has(dependency) || completed.has(dependency),
        ),
    );
    if (!next) {
      return undefined;
    }
    completed.add(next);
    ordered.push(next);
  }
  return ordered;
}

function ancestorsFor(
  phaseId: string,
  dependencies: Readonly<Record<string, readonly string[]>>,
): ReadonlySet<string> {
  const ancestors = new Set<string>();
  const queue = [...(dependencies[phaseId] ?? [])];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (ancestors.has(current)) {
      continue;
    }
    ancestors.add(current);
    queue.push(...(dependencies[current] ?? []));
  }
  return ancestors;
}

export function taskDefinitionHash(task: ExecutionTask): string {
  return contentHash(task);
}

export function validateDevelopmentGraph(
  plan: ExecutionPlanVersion,
): DevelopmentGraphResult {
  const issues: DevelopmentGraphIssue[] = [];
  const phaseIds = plan.phases.map(({ id }) => id);
  const taskIds = plan.tasks.map(({ id }) => id);
  const knownPhases = new Set(phaseIds);
  const knownTasks = new Set(taskIds);

  for (const id of duplicates(phaseIds)) {
    issues.push({
      code: "duplicate_phase",
      path: `phases.${id}`,
      message: `Execution Plan contains duplicate phase ${id}`,
    });
  }
  for (const id of duplicates(taskIds)) {
    issues.push({
      code: "duplicate_task",
      path: `tasks.${id}`,
      message: `Execution Plan contains duplicate task ${id}`,
    });
  }

  const phaseDependencies: Record<string, readonly string[]> = {};
  for (const phase of plan.phases) {
    phaseDependencies[phase.id] = [...phase.dependsOnPhaseIds];
    for (const dependency of phase.dependsOnPhaseIds) {
      if (!knownPhases.has(dependency) || dependency === phase.id) {
        issues.push({
          code: "unknown_phase_dependency",
          path: `phases.${phase.id}.dependsOnPhaseIds`,
          message: `Phase ${phase.id} has an invalid dependency ${dependency}`,
        });
      }
    }
  }
  const phaseOrder = stableTopologicalOrder(phaseIds, phaseDependencies);
  if (!phaseOrder && phaseIds.length > 0) {
    issues.push({
      code: "phase_cycle",
      path: "phases",
      message: "Phase dependencies contain a cycle",
    });
  }

  const taskPhase: Record<string, string> = {};
  const taskReferences = new Map<string, string[]>();
  for (const phase of plan.phases) {
    for (const taskId of phase.taskIds) {
      const references = taskReferences.get(taskId) ?? [];
      references.push(phase.id);
      taskReferences.set(taskId, references);
      if (!knownTasks.has(taskId)) {
        issues.push({
          code: "unknown_task",
          path: `phases.${phase.id}.taskIds`,
          message: `Phase ${phase.id} references unknown task ${taskId}`,
        });
      }
    }
  }
  for (const task of plan.tasks) {
    taskPhase[task.id] = task.phaseId;
    const references = taskReferences.get(task.id) ?? [];
    if (references.length !== 1) {
      issues.push({
        code: "orphan_task",
        path: `tasks.${task.id}`,
        message: `Task ${task.id} must appear in exactly one phase task list`,
      });
    } else if (references[0] !== task.phaseId || !knownPhases.has(task.phaseId)) {
      issues.push({
        code: "task_phase_mismatch",
        path: `tasks.${task.id}.phaseId`,
        message: `Task ${task.id} does not match its containing phase`,
      });
    }
  }

  const taskDependencies: Record<string, readonly string[]> = {};
  for (const task of plan.tasks) {
    taskDependencies[task.id] = [...task.dependsOn];
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) {
        issues.push({
          code: "self_dependency",
          path: `tasks.${task.id}.dependsOn`,
          message: `Task ${task.id} depends on itself`,
        });
      } else if (!knownTasks.has(dependency)) {
        issues.push({
          code: "unknown_task_dependency",
          path: `tasks.${task.id}.dependsOn`,
          message: `Task ${task.id} depends on unknown task ${dependency}`,
        });
      }
    }
  }
  const taskOrder = stableTopologicalOrder(taskIds, taskDependencies);
  if (!taskOrder && taskIds.length > 0) {
    issues.push({
      code: "task_cycle",
      path: "tasks",
      message: "Task dependencies contain a cycle",
    });
  }

  if (phaseOrder && taskOrder) {
    for (const task of plan.tasks) {
      const phaseAncestors = ancestorsFor(task.phaseId, phaseDependencies);
      for (const dependencyId of task.dependsOn) {
        const dependencyPhase = taskPhase[dependencyId];
        if (
          dependencyPhase &&
          dependencyPhase !== task.phaseId &&
          !phaseAncestors.has(dependencyPhase)
        ) {
          issues.push({
            code: "impossible_task_order",
            path: `tasks.${task.id}.dependsOn`,
            message: `Task ${task.id} depends on ${dependencyId} from a non-ancestor phase`,
          });
        }
      }
    }
  }

  const gateIds = plan.userGates.map(({ id }) => id);
  for (const id of duplicates(gateIds)) {
    issues.push({
      code: "duplicate_user_gate",
      path: `userGates.${id}`,
      message: `Execution Plan contains duplicate User Gate ${id}`,
    });
  }
  for (const gate of plan.userGates) {
    if (!knownPhases.has(gate.afterPhaseId)) {
      issues.push({
        code: "unknown_user_gate",
        path: `userGates.${gate.id}.afterPhaseId`,
        message: `User Gate ${gate.id} references unknown phase ${gate.afterPhaseId}`,
      });
    }
  }

  if (issues.length > 0 || !phaseOrder || !taskOrder) {
    return { valid: false, issues };
  }
  return {
    valid: true,
    issues: [],
    graph: {
      phaseOrder,
      taskOrder,
      phaseDependencies,
      taskDependencies,
      taskPhase,
      graphHash: contentHash({
        phases: plan.phases,
        tasks: plan.tasks,
        userGates: plan.userGates,
      }),
    },
  };
}

export function dependentTaskIds(
  graph: DevelopmentExecutionGraph,
  rootTaskIds: readonly string[],
): readonly string[] {
  const affected = new Set(rootTaskIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const taskId of graph.taskOrder) {
      if (
        !affected.has(taskId) &&
        (graph.taskDependencies[taskId] ?? []).some((dependency) =>
          affected.has(dependency),
        )
      ) {
        affected.add(taskId);
        changed = true;
      }
    }
  }
  return graph.taskOrder.filter((taskId) => affected.has(taskId));
}
