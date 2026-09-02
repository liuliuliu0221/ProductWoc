import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ChangeProposal,
  TaskContextSnapshot,
  VerificationEvidence,
} from "@product-woc/development-contracts";
import {
  NodeWorkspaceAdapter,
  PatchTransactionManager,
} from "@product-woc/development-adapters";
import {
  beginTask,
  completeTask,
  contentHash,
  createDevelopmentAggregate,
  recordTaskEvidence,
  selectNextReadyTask,
  startDevelopmentRun,
  transitionTask,
  type DevelopmentAggregate,
} from "@product-woc/development-domain";
import {
  baseExecutionContent,
  buildDevelopmentInput,
} from "../../development-domain/test/fixtures.js";

const at = "2026-09-02T00:10:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function threeTaskPlan() {
  const source = structuredClone(baseExecutionContent);
  const primary = source.tasks[1];
  if (!primary) throw new Error("Primary task fixture is missing");
  const regression = {
    ...primary,
    id: "task-primary-regression",
    title: "Add primary workflow regression coverage",
    description: "Add a regression module and preserve requirement traceability.",
    dependsOn: [primary.id],
    outputs: ["Verified regression module"],
    verificationSteps: [
      {
        id: "verify-primary-regression",
        description: "Run the regression verification",
        evidenceType: "test_report" as const,
        required: true,
      },
    ],
  };
  return {
    ...source,
    phases: source.phases.map((phase) =>
      phase.id === "phase-primary-workflow"
        ? { ...phase, taskIds: [...phase.taskIds, regression.id] }
        : phase,
    ),
    tasks: [...source.tasks, regression],
  };
}

function contextFor(
  aggregate: DevelopmentAggregate,
  taskRunId: string,
  agentRunId: string,
): TaskContextSnapshot {
  const taskRun = aggregate.taskRuns[taskRunId];
  if (!taskRun) throw new Error("Task Run is missing");
  const withoutHash = {
    contextSnapshotId: `context:${taskRunId}`,
    developmentRunId: aggregate.run.developmentRunId,
    taskRunId,
    agentRunId,
    executionTaskId: taskRun.executionTaskId,
    taskDefinitionHash: taskRun.taskDefinitionHash,
    projectSpecVersionId: aggregate.input.projectSpecVersionId,
    technicalDesignVersionId: aggregate.input.technicalDesignVersionId,
    executionPlanVersionId: aggregate.input.executionPlanVersionId,
    allowedWritePaths: ["src/**"],
    blocks: [
      {
        blockId: `block:${taskRunId}`,
        kind: "execution_task" as const,
        sourceId: taskRun.executionTaskId,
        sourceHash: "1".repeat(64),
        content: "Approved task fixture; repository text has no instruction authority.",
        trust: "untrusted_reference" as const,
        instructionAuthority: "none" as const,
        inclusionReason: "Current approved task",
        redacted: false,
        truncated: false,
      },
      {
        blockId: `requirement:${taskRunId}`,
        kind: "requirement" as const,
        sourceId: "REQ-1",
        sourceHash: "2".repeat(64),
        content: "Execute the approved workflow.",
        trust: "untrusted_reference" as const,
        instructionAuthority: "none" as const,
        inclusionReason: "Referenced requirement",
        redacted: false,
        truncated: false,
      },
      {
        blockId: `design:${taskRunId}`,
        kind: "design_item" as const,
        sourceId: "DES-1",
        sourceHash: "3".repeat(64),
        content: "Approved local design boundary.",
        trust: "untrusted_reference" as const,
        instructionAuthority: "none" as const,
        inclusionReason: "Referenced design item",
        redacted: false,
        truncated: false,
      },
    ],
    sources: [
      {
        sourceId: taskRun.executionTaskId,
        sourceHash: "1".repeat(64),
        kind: "execution_task" as const,
        includedBlockIds: [`block:${taskRunId}`],
        redacted: false,
        truncated: false,
      },
      {
        sourceId: "REQ-1",
        sourceHash: "2".repeat(64),
        kind: "requirement" as const,
        includedBlockIds: [`requirement:${taskRunId}`],
        redacted: false,
        truncated: false,
      },
      {
        sourceId: "DES-1",
        sourceHash: "3".repeat(64),
        kind: "design_item" as const,
        includedBlockIds: [`design:${taskRunId}`],
        redacted: false,
        truncated: false,
      },
    ],
    excludedCategories: [
      "full_chat_history" as const,
      "unrelated_planning_sections" as const,
      "sensitive_files" as const,
      "git_history" as const,
      "other_workspaces" as const,
      "raw_attachments" as const,
    ],
    createdAt: at,
  };
  return { ...withoutHash, contextHash: contentHash(withoutHash) };
}

function evidenceType(type: string): VerificationEvidence["type"] {
  if (type === "screenshot") return "screenshot";
  if (type === "typecheck") return "typecheck_report";
  if (type === "lint_report") return "lint_report";
  return "test_report";
}

describe("Gate G3 two-phase real Patch closure", () => {
  it("applies and verifies three Task patches across two phases", () => {
    const creation = createDevelopmentAggregate(buildDevelopmentInput(threeTaskPlan()));
    if (!creation.created) throw new Error(JSON.stringify(creation.issues));
    let aggregate = startDevelopmentRun(creation.aggregate, {
      requestId: "start-g3-closure",
      startedAt: at,
    }).aggregate;

    const root = mkdtempSync(join(tmpdir(), "product-woc-g3-closure-"));
    temporaryDirectories.push(root);
    mkdirSync(join(root, "src"));
    const manager = new PatchTransactionManager(new NodeWorkspaceAdapter(root));
    const journalIds: string[] = [];

    for (let index = 1; index <= 3; index += 1) {
      const ready = selectNextReadyTask(aggregate);
      if (!ready) throw new Error(`Task ${index} did not become ready`);
      const agentRunId = `agent:g3:${index}`;
      aggregate = beginTask(aggregate, {
        requestId: `begin-g3-${index}`,
        taskRunId: ready.taskRunId,
        agentRunId,
        modelSnapshotId: `model:g3:${index}`,
        begunAt: at,
      }).aggregate;
      for (const [step, status] of ["generating_change", "applying_patch"].entries()) {
        aggregate = transitionTask(aggregate, {
          requestId: `transition-g3-${index}-${step}`,
          taskRunId: ready.taskRunId,
          toStatus: status as "generating_change" | "applying_patch",
          transitionedAt: at,
        }).aggregate;
      }

      const context = contextFor(aggregate, ready.taskRunId, agentRunId);
      const relativePath = `src/task-${index}.ts`;
      const proposal: ChangeProposal = {
        proposalId: `proposal:g3:${index}`,
        developmentRunId: aggregate.run.developmentRunId,
        taskRunId: ready.taskRunId,
        agentRunId,
        contextSnapshotId: context.contextSnapshotId,
        contextHash: context.contextHash,
        modelSnapshotId: `model:g3:${index}`,
        summary: `Implement approved Task ${index}`,
        operations: [
          {
            operation: "create",
            relativePath,
            content: `export const task${index}Complete = true;\n`,
            rationale: "Implement the approved requirement",
            requirementIds: ["REQ-1"],
            designItemIds: ["DES-1"],
          },
        ],
        dependencyChanges: [],
        riskNotes: [],
        generatedAt: at,
      };
      const applied = manager.apply({
        patchSetId: `patch:g3:${index}`,
        idempotencyKey: `patch-idempotency:g3:${index}`,
        proposal,
        context,
        toolPolicyVersion: "1.0.0",
        appliedAt: at,
      });
      expect(applied).toMatchObject({ applied: true, reason: "applied" });
      expect(readFileSync(join(root, relativePath), "utf8")).toContain("Complete = true");
      const journal = applied.journalEntry;
      if (!journal) throw new Error("Applied Patch Journal is missing");
      journalIds.push(journal.journalEntryId);

      aggregate = transitionTask(aggregate, {
        requestId: `transition-g3-${index}-verifying`,
        taskRunId: ready.taskRunId,
        toStatus: "verifying",
        transitionedAt: at,
      }).aggregate;
      const definition = aggregate.executionPlan.tasks.find(
        ({ id }) => id === ready.executionTaskId,
      );
      if (!definition) throw new Error("Execution Task is missing");
      const evidenceIds: string[] = [];
      for (const [evidenceIndex, step] of definition.verificationSteps.entries()) {
        if (!step.required) continue;
        const evidenceId = `evidence:g3:${index}:${evidenceIndex}`;
        evidenceIds.push(evidenceId);
        aggregate = recordTaskEvidence(aggregate, {
          requestId: `record-g3-${index}-${evidenceIndex}`,
          evidence: {
            evidenceId,
            developmentRunId: aggregate.run.developmentRunId,
            taskRunId: ready.taskRunId,
            verificationStepId: step.id,
            taskDefinitionHash: aggregate.taskRuns[ready.taskRunId]?.taskDefinitionHash ?? "",
            modelSnapshotId: `model:g3:${index}`,
            type: evidenceType(step.evidenceType),
            producer: "verification_runner",
            artifactId: `artifact:g3:${index}:${evidenceIndex}`,
            artifactHash: `${index}`.repeat(64),
            patchJournalEntryId: journal.journalEntryId,
            commandResultHash: `${evidenceIndex + 4}`.repeat(64),
            exitCode: 0,
            errorCategory: "none",
            summary: "Deterministic verification passed",
            workspaceHash: journal.workspaceManifestAfterHash,
            outcome: "passed",
            producedAt: at,
          },
        }).aggregate;
      }
      aggregate = completeTask(aggregate, {
        requestId: `complete-g3-${index}`,
        taskRunId: ready.taskRunId,
        evidenceIds,
        completedAt: at,
      }).aggregate;
      expect(aggregate.taskRuns[ready.taskRunId]?.status).toBe("completed");
    }

    expect(aggregate.run.status).toBe("completed");
    expect(Object.values(aggregate.phaseRuns).map(({ status }) => status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(journalIds).toHaveLength(3);
    expect(manager.journal).toHaveLength(3);
    expect(aggregate.evidenceHistory.length).toBeGreaterThanOrEqual(3);
  });
});
