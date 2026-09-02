import { describe, expect, it } from "vitest";

import type { ApprovalBindingV2 } from "@product-woc/planning-contracts";

import {
  allowedTransitionsFor,
  assertTransition,
  canonicalize,
  contentHash,
  invalidationTargetsFor,
  validateApprovalBinding,
} from "../src/index.js";

const hash = "a".repeat(64);

describe("canonical content", () => {
  it("is stable across object key order", () => {
    const left = { title: "Tracker", nested: { b: 2, a: 1 } };
    const right = { nested: { a: 1, b: 2 }, title: "Tracker" };

    expect(canonicalize(left)).toBe(canonicalize(right));
    expect(contentHash(left)).toBe(contentHash(right));
  });

  it("preserves array order", () => {
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["b", "a"]));
  });

  it("holds key-order invariance across deterministic permutations", () => {
    const entries = [
      ["alpha", 1],
      ["beta", 2],
      ["gamma", 3],
      ["delta", 4],
    ] as const;
    const expected = contentHash(Object.fromEntries(entries));

    for (let offset = 0; offset < entries.length; offset += 1) {
      const permutation = [
        ...entries.slice(offset),
        ...entries.slice(0, offset),
      ];
      expect(contentHash(Object.fromEntries(permutation))).toBe(expected);
    }
  });
});

describe("approval binding", () => {
  const approval: ApprovalBindingV2 = {
    approvalId: "approval-1",
    projectId: "project-1",
    workflowRunId: "run-1",
    stageRunId: "stage-1",
    subjectType: "project_spec",
    subjectVersionId: "spec-1",
    subjectHash: hash,
    approvalPolicyVersion: "2.0.0",
    approvedBy: "user-1",
    approvedAt: "2026-08-27T08:00:00+08:00",
  };

  it("accepts the exact immutable subject", () => {
    expect(
      validateApprovalBinding(approval, {
        projectId: "project-1",
        workflowRunId: "run-1",
        subjectType: "project_spec",
        versionId: "spec-1",
        hash,
        approvalPolicyVersion: "2.0.0",
      }),
    ).toEqual({ valid: true });
  });

  it("rejects an approval for an old hash", () => {
    expect(
      validateApprovalBinding(approval, {
        projectId: "project-1",
        workflowRunId: "run-1",
        subjectType: "project_spec",
        versionId: "spec-1",
        hash: "b".repeat(64),
        approvalPolicyVersion: "2.0.0",
      }),
    ).toEqual({ valid: false, reason: "subject_mismatch" });
  });
});

describe("planning rules", () => {
  it("covers the complete downstream invalidation matrix", () => {
    const expected = {
      project_spec: ["project_spec", "technical_design", "execution_plan"],
      technical_design: ["technical_design", "execution_plan"],
      execution_plan: ["execution_plan"],
    } as const;

    for (const [changedSubject, invalidatedSubjects] of Object.entries(expected)) {
      const targets = invalidationTargetsFor(
        changedSubject as keyof typeof expected,
      );
      expect(targets.map(({ subject }) => subject)).toEqual(invalidatedSubjects);
      expect(
        targets.every(
          (target) =>
            target.invalidateApproval &&
            target.invalidateContext &&
            target.invalidateEvidence &&
            target.invalidateDevelopmentStart,
        ),
      ).toBe(true);
    }
  });

  it("rejects stage skipping", () => {
    expect(() =>
      assertTransition("collecting_idea", "ready_for_development"),
    ).toThrow("Invalid planning transition");
  });

  it("allows reviewed revisions from ready while cancellation stays terminal", () => {
    expect(allowedTransitionsFor("ready_for_development")).toEqual([
      "generating_product_spec",
      "generating_technical_design",
      "generating_execution_plan",
    ]);
    expect(allowedTransitionsFor("cancelled")).toEqual([]);
  });
});
