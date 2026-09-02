import { describe, expect, it } from "vitest";

import { executionPlanContentSchema } from "@product-woc/planning-contracts";

import { validateDevelopmentGraph } from "../src/index.js";
import { baseExecutionContent, buildDevelopmentInput } from "./fixtures.js";

function issueCodes(
  content: Parameters<typeof buildDevelopmentInput>[0],
): readonly string[] {
  const result = validateDevelopmentGraph(buildDevelopmentInput(content).executionPlan);
  return result.valid ? [] : result.issues.map(({ code }) => code);
}

describe("development execution graph", () => {
  it("produces the same stable order and hash for the same plan", () => {
    const plan = buildDevelopmentInput().executionPlan;
    const first = validateDevelopmentGraph(plan);
    const second = validateDevelopmentGraph(structuredClone(plan));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      valid: true,
      graph: {
        phaseOrder: ["phase-foundation", "phase-primary-workflow"],
        taskOrder: ["task-foundation", "task-primary-workflow"],
      },
    });
  });

  it("rejects task cycles", () => {
    const content = executionPlanContentSchema.parse({
      ...structuredClone(baseExecutionContent),
      tasks: baseExecutionContent.tasks.map((task) =>
        task.id === "task-foundation"
          ? { ...task, dependsOn: ["task-primary-workflow"] }
          : task,
      ),
    });
    expect(issueCodes(content)).toContain("task_cycle");
  });

  it("rejects unknown dependencies without misreporting a cycle", () => {
    const content = executionPlanContentSchema.parse({
      ...structuredClone(baseExecutionContent),
      tasks: baseExecutionContent.tasks.map((task) =>
        task.id === "task-foundation"
          ? { ...task, dependsOn: ["unknown-task"] }
          : task,
      ),
    });
    expect(issueCodes(content)).toContain("unknown_task_dependency");
    expect(issueCodes(content)).not.toContain("task_cycle");
  });

  it("rejects orphan tasks", () => {
    const content = executionPlanContentSchema.parse({
      ...structuredClone(baseExecutionContent),
      phases: baseExecutionContent.phases.map((phase) =>
        phase.id === "phase-foundation" ? { ...phase, taskIds: ["unknown-task"] } : phase,
      ),
    });
    expect(issueCodes(content)).toEqual(
      expect.arrayContaining(["unknown_task", "orphan_task"]),
    );
  });

  it("rejects a cross-phase dependency on a non-ancestor phase", () => {
    const content = executionPlanContentSchema.parse({
      ...structuredClone(baseExecutionContent),
      phases: baseExecutionContent.phases.map((phase) => ({
        ...phase,
        dependsOnPhaseIds: [],
      })),
    });
    expect(issueCodes(content)).toContain("impossible_task_order");
  });
});
