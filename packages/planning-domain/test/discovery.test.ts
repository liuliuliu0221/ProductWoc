import { describe, expect, it } from "vitest";

import type { RequirementUnderstanding } from "@product-woc/planning-contracts";

import {
  analyzeDiscovery,
  applyClarificationResolution,
  resolveClarifications,
} from "../src/index.js";

function understanding(
  overrides: Partial<RequirementUnderstanding> = {},
): RequirementUnderstanding {
  return {
    summary: "A customer feedback tracker",
    targetUsers: ["Product managers"],
    coreTasks: ["Capture and triage feedback"],
    assumptions: [],
    risks: [],
    support: {
      level: "supported",
      reason: "Fits the supported web product scope",
    },
    uncertainties: [],
    ...overrides,
  };
}

describe("discovery", () => {
  it("asks at most the three highest-scoring blocking questions", () => {
    const analysis = analyzeDiscovery(
      understanding({
        uncertainties: [
          {
            id: "q-low",
            topic: "Low",
            question: "Low impact?",
            recommendedDefault: "Default low",
            impact: "Minor",
            blocking: true,
            score: 0.2,
          },
          {
            id: "q-nonblocking",
            topic: "Optional",
            question: "Optional detail?",
            recommendedDefault: "Skip it",
            impact: "None for MVP",
            blocking: false,
            score: 1,
          },
          ...[0.9, 0.8, 0.7].map((score, index) => ({
            id: `q-${index}`,
            topic: `Topic ${index}`,
            question: `Question ${index}?`,
            recommendedDefault: `Default ${index}`,
            impact: `Impact ${index}`,
            blocking: true as const,
            score,
          })),
        ],
      }),
    );

    expect(analysis.outcome).toBe("awaiting_clarification");
    expect(analysis.questions.map(({ id }) => id)).toEqual(["q-0", "q-1", "q-2"]);
  });

  it("records custom and adopted-default answers explicitly", () => {
    const analysis = analyzeDiscovery(
      understanding({
        uncertainties: [
          {
            id: "q-access",
            topic: "Access",
            question: "Who can submit feedback?",
            recommendedDefault: "Workspace members",
            impact: "Changes authentication and permissions",
            blocking: true,
            score: 0.9,
          },
          {
            id: "q-retention",
            topic: "Retention",
            question: "How long is feedback retained?",
            recommendedDefault: "One year",
            impact: "Changes storage policy",
            blocking: true,
            score: 0.8,
          },
        ],
      }),
    );
    const resolution = resolveClarifications(
      analysis,
      [
        {
          questionId: "q-access",
          answer: "Any authenticated customer",
          useRecommendedDefault: false,
        },
        { questionId: "q-retention", useRecommendedDefault: true },
      ],
      { actorId: "user-1", recordedAt: "2026-08-27T10:00:00+08:00" },
    );

    expect(resolution.complete).toBe(true);
    expect(resolution.decisions).toMatchObject([
      { kind: "clarification_answer", value: "Any authenticated customer" },
      { kind: "adopted_default", value: "One year" },
    ]);
    expect(applyClarificationResolution(analysis, resolution)).toMatchObject({
      outcome: "ready_for_spec",
      questions: [],
    });
  });

  it("does not interview for unsupported or high-risk requests", () => {
    const analysis = analyzeDiscovery(
      understanding({
        support: {
          level: "needs_user_action",
          reason: "The request performs regulated external money movement",
          safeFallback: "Create a read-only review and approval workflow",
        },
        uncertainties: [
          {
            id: "q-bank",
            topic: "Bank",
            question: "Which bank?",
            recommendedDefault: "None",
            impact: "Would select a money movement provider",
            blocking: true,
            score: 1,
          },
        ],
      }),
    );

    expect(analysis).toMatchObject({ outcome: "needs_user_action", questions: [] });
  });
});
