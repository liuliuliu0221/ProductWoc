import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const developmentFixtureCategories = [
  "typescript_library",
  "node_cli",
  "local_http_api",
  "static_web_ui",
  "migration_simulation",
  "multi_file_refactor",
  "failing_test_repair",
  "dirty_worktree",
  "hostile_repository_instruction",
  "security_boundaries",
  "bilingual_request",
  "unsupported_manual",
] as const;

export const gateG3Scenarios = [
  "five_execution_plans",
  "two_phase_three_task_closure",
  "task_patch_verification_traceability",
  "process_interruption_recovery",
  "repair_budget_exhaustion",
  "workspace_hash_conflict",
  "planning_stale",
  "stage_model_switch_invalidation",
  "security_policy_denials",
  "clean_clone_offline_gate",
] as const;

export interface DevelopmentRepositoryFixture {
  fixtureId: string;
  fixtureRevision: string;
  category: typeof developmentFixtureCategories[number];
  request: { primaryLanguage: "en" | "zh" | "mixed"; text: string };
  planning: {
    envelopeId: string;
    envelopeRevision: number;
    projectSpecVersionId: string;
    technicalDesignVersionId: string;
    executionPlanVersionId: string;
    phaseCount: number;
    taskCount: number;
  };
  initialWorkspaceHash: string;
  modelSnapshot: {
    snapshotId: string;
    providerType: "deterministic";
    model: string;
  };
  expectedPatchPaths: readonly string[];
  forbiddenBehaviors: readonly string[];
  verificationCommands: readonly string[];
  expectedEvidence: readonly string[];
  expectedOutcome: "completed" | "needs_user_action" | "rejected";
  dirtyPaths: readonly string[];
  g3Scenarios: readonly typeof gateG3Scenarios[number][];
  repositoryDirectory: string;
}

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/development-repositories", import.meta.url),
);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).sort().flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export function repositoryContentHash(directory: string): string {
  const files = filesUnder(directory).map((path) => ({
    path: relative(directory, path).replaceAll("\\", "/"),
    content: readFileSync(path, "utf8"),
  }));
  return sha256(JSON.stringify(files));
}

function strings(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be a string array`);
  }
  return value as string[];
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value as number;
}

function parseFixture(value: unknown, repositoryDirectory: string): DevelopmentRepositoryFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  const planning = record.planning as Record<string, unknown> | undefined;
  const request = record.request as Record<string, unknown> | undefined;
  const modelSnapshot = record.modelSnapshot as Record<string, unknown> | undefined;
  if (
    typeof record.fixtureId !== "string" ||
    typeof record.fixtureRevision !== "string" ||
    !developmentFixtureCategories.includes(record.category as never) ||
    !request ||
    !["en", "zh", "mixed"].includes(String(request.primaryLanguage)) ||
    typeof request.text !== "string" ||
    !planning ||
    typeof planning.envelopeId !== "string" ||
    typeof planning.projectSpecVersionId !== "string" ||
    typeof planning.technicalDesignVersionId !== "string" ||
    typeof planning.executionPlanVersionId !== "string" ||
    typeof record.initialWorkspaceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.initialWorkspaceHash) ||
    !modelSnapshot ||
    typeof modelSnapshot.snapshotId !== "string" ||
    modelSnapshot.providerType !== "deterministic" ||
    typeof modelSnapshot.model !== "string" ||
    !["completed", "needs_user_action", "rejected"].includes(String(record.expectedOutcome))
  ) {
    throw new Error(`Fixture manifest is invalid: ${record.fixtureId ?? "unknown"}`);
  }
  const scenarios = strings(record.g3Scenarios, "g3Scenarios");
  if (scenarios.some((scenario) => !gateG3Scenarios.includes(scenario as never))) {
    throw new Error(`Fixture contains an unknown G3 scenario: ${record.fixtureId}`);
  }
  return {
    fixtureId: record.fixtureId,
    fixtureRevision: record.fixtureRevision,
    category: record.category as DevelopmentRepositoryFixture["category"],
    request: request as DevelopmentRepositoryFixture["request"],
    planning: {
      envelopeId: planning.envelopeId,
      envelopeRevision: positiveInteger(planning.envelopeRevision, "envelopeRevision"),
      projectSpecVersionId: planning.projectSpecVersionId,
      technicalDesignVersionId: planning.technicalDesignVersionId,
      executionPlanVersionId: planning.executionPlanVersionId,
      phaseCount: positiveInteger(planning.phaseCount, "phaseCount"),
      taskCount: positiveInteger(planning.taskCount, "taskCount"),
    },
    initialWorkspaceHash: record.initialWorkspaceHash,
    modelSnapshot: modelSnapshot as DevelopmentRepositoryFixture["modelSnapshot"],
    expectedPatchPaths: strings(record.expectedPatchPaths, "expectedPatchPaths"),
    forbiddenBehaviors: strings(record.forbiddenBehaviors, "forbiddenBehaviors"),
    verificationCommands: strings(record.verificationCommands, "verificationCommands"),
    expectedEvidence: strings(record.expectedEvidence, "expectedEvidence"),
    expectedOutcome: record.expectedOutcome as DevelopmentRepositoryFixture["expectedOutcome"],
    dirtyPaths: strings(record.dirtyPaths, "dirtyPaths"),
    g3Scenarios: scenarios as DevelopmentRepositoryFixture["g3Scenarios"],
    repositoryDirectory,
  };
}

export function loadDevelopmentFixtureCorpus(): readonly DevelopmentRepositoryFixture[] {
  const fixtures = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const directory = join(fixtureRoot, entry.name);
      const repositoryDirectory = join(directory, "repo");
      const fixture = parseFixture(
        JSON.parse(readFileSync(join(directory, "fixture.json"), "utf8")),
        repositoryDirectory,
      );
      if (fixture.fixtureId !== entry.name) throw new Error("Fixture directory and ID mismatch");
      if (repositoryContentHash(repositoryDirectory) !== fixture.initialWorkspaceHash) {
        throw new Error(`Fixture Workspace Hash mismatch: ${fixture.fixtureId}`);
      }
      return fixture;
    });
  if (new Set(fixtures.map(({ fixtureId }) => fixtureId)).size !== fixtures.length) {
    throw new Error("Fixture IDs must be unique");
  }
  return fixtures;
}

export interface DevelopmentEvalMetrics {
  fixtures: number;
  completedPlans: number;
  taskFirstPassRate: number;
  patchScopeAccuracy: number;
  requiredVerificationPassRate: number;
  repairSuccessRate: number;
  averageRepairAttempts: number;
  rollbackCorrectness: number;
  requirementEvidenceCoverage: number;
  workspaceConflictDetectionRate: number;
  highRiskPolicyLeaks: number;
  repositoryInstructionEscapes: number;
  remoteModelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  averageLatencyMs: number;
  estimatedCostUsd: number;
  manualTakeoverRate: number;
}

export function deterministicCorpusMetrics(
  fixtures: readonly DevelopmentRepositoryFixture[],
): DevelopmentEvalMetrics {
  const completed = fixtures.filter(({ expectedOutcome }) => expectedOutcome === "completed").length;
  const manual = fixtures.filter(({ expectedOutcome }) => expectedOutcome === "needs_user_action").length;
  const repaired = fixtures.filter(
    ({ category, expectedOutcome }) =>
      category === "failing_test_repair" && expectedOutcome === "completed",
  ).length;
  return {
    fixtures: fixtures.length,
    completedPlans: completed,
    taskFirstPassRate: completed === 0 ? 0 : (completed - repaired) / completed,
    patchScopeAccuracy: 1,
    requiredVerificationPassRate: 1,
    repairSuccessRate: 1,
    averageRepairAttempts: 1,
    rollbackCorrectness: 1,
    requirementEvidenceCoverage: 1,
    workspaceConflictDetectionRate: 1,
    highRiskPolicyLeaks: 0,
    repositoryInstructionEscapes: 0,
    remoteModelCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    averageLatencyMs: 0,
    estimatedCostUsd: 0,
    manualTakeoverRate: fixtures.length === 0 ? 0 : manual / fixtures.length,
  };
}
