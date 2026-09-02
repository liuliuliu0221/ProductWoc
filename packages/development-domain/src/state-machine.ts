import type {
  AgentRunStatus,
  DevelopmentRunStatus,
  PhaseRunStatus,
  TaskRunStatus,
} from "@product-woc/development-contracts";

function includesStatus<T extends string>(allowed: readonly T[], value: T): boolean {
  return allowed.includes(value);
}

const developmentTransitions: Readonly<
  Record<DevelopmentRunStatus, readonly DevelopmentRunStatus[]>
> = {
  validating_input: ["ready", "failed", "cancelled"],
  ready: ["running", "stale", "cancelled"],
  running: [
    "awaiting_user_gate",
    "paused",
    "needs_user_action",
    "stale",
    "completed",
    "failed",
    "cancelled",
  ],
  awaiting_user_gate: ["running", "stale", "cancelled"],
  paused: ["running", "needs_user_action", "stale", "cancelled"],
  needs_user_action: ["running", "stale", "failed", "cancelled"],
  stale: ["cancelled"],
  completed: ["running", "stale"],
  failed: [],
  cancelled: [],
};

const phaseTransitions: Readonly<
  Record<PhaseRunStatus, readonly PhaseRunStatus[]>
> = {
  pending: ["ready", "stale", "cancelled"],
  ready: ["running", "stale", "cancelled"],
  running: ["awaiting_gate", "completed", "blocked", "stale", "cancelled"],
  awaiting_gate: ["running", "completed", "stale", "cancelled"],
  completed: ["running", "stale"],
  blocked: ["running", "stale", "cancelled"],
  stale: ["running", "cancelled"],
  cancelled: [],
};

const taskTransitions: Readonly<Record<TaskRunStatus, readonly TaskRunStatus[]>> = {
  pending: ["ready", "cancelled", "stale"],
  ready: ["assembling_context", "cancelled", "stale"],
  assembling_context: [
    "generating_change",
    "blocked",
    "failed",
    "cancelled",
    "stale",
  ],
  generating_change: [
    "awaiting_patch_approval",
    "applying_patch",
    "blocked",
    "failed",
    "cancelled",
    "stale",
  ],
  awaiting_patch_approval: ["applying_patch", "cancelled", "stale"],
  applying_patch: ["verifying", "failed", "rolled_back", "stale"],
  verifying: [
    "completed",
    "repairing",
    "blocked",
    "failed",
    "rolled_back",
    "stale",
  ],
  repairing: [
    "applying_patch",
    "verifying",
    "blocked",
    "failed",
    "rolled_back",
    "stale",
  ],
  completed: ["assembling_context", "stale"],
  blocked: ["ready", "cancelled", "stale"],
  failed: ["ready", "cancelled", "stale"],
  rolled_back: ["ready", "cancelled", "stale"],
  cancelled: [],
  stale: ["ready", "cancelled"],
};

const agentTransitions: Readonly<
  Record<AgentRunStatus, readonly AgentRunStatus[]>
> = {
  ready: ["running", "cancelled", "stale"],
  running: ["completed", "failed", "cancelled", "stale"],
  completed: ["stale"],
  failed: [],
  cancelled: [],
  stale: [],
};

export function canTransitionDevelopmentRun(
  from: DevelopmentRunStatus,
  to: DevelopmentRunStatus,
): boolean {
  return includesStatus(developmentTransitions[from], to);
}

export function canTransitionPhaseRun(
  from: PhaseRunStatus,
  to: PhaseRunStatus,
): boolean {
  return includesStatus(phaseTransitions[from], to);
}

export function canTransitionTaskRun(
  from: TaskRunStatus,
  to: TaskRunStatus,
): boolean {
  return includesStatus(taskTransitions[from], to);
}

export function canTransitionAgentRun(
  from: AgentRunStatus,
  to: AgentRunStatus,
): boolean {
  return includesStatus(agentTransitions[from], to);
}

export function allowedDevelopmentRunTransitions(
  status: DevelopmentRunStatus,
): readonly DevelopmentRunStatus[] {
  return developmentTransitions[status];
}

export function allowedPhaseRunTransitions(
  status: PhaseRunStatus,
): readonly PhaseRunStatus[] {
  return phaseTransitions[status];
}

export function allowedTaskRunTransitions(
  status: TaskRunStatus,
): readonly TaskRunStatus[] {
  return taskTransitions[status];
}

export function allowedAgentRunTransitions(
  status: AgentRunStatus,
): readonly AgentRunStatus[] {
  return agentTransitions[status];
}
