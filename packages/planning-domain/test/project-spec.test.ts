import { describe, expect, it } from "vitest";

import type { ProjectSpecContent } from "@product-woc/planning-contracts";

import {
  applyProjectSpecRevision,
  contentHash,
  type JsonValue,
} from "../src/index.js";

const content: ProjectSpecContent = {
  title: "Feedback tracker",
  summary: "Capture feedback",
  targetUsers: ["Product managers"],
  coreTasks: ["Capture feedback"],
  successMetrics: ["Feedback is triaged"],
  inScope: ["Feedback capture"],
  outOfScope: ["Public roadmap"],
  requirements: [
    {
      id: "REQ-1",
      title: "Capture",
      description: "Capture customer feedback",
      acceptanceCriteria: [{ id: "AC-1", description: "Validate required fields" }],
      sources: [],
    },
  ],
  assumptions: [],
  risks: [],
  openQuestions: [],
};

describe("Project Spec revision", () => {
  it("creates complete new content from a single-field patch", () => {
    const revised = applyProjectSpecRevision(content, {
      inScope: ["Feedback capture", "Status-based triage"],
    });

    expect(revised).not.toBe(content);
    expect(content.inScope).toEqual(["Feedback capture"]);
    expect(revised.inScope).toEqual(["Feedback capture", "Status-based triage"]);
    expect(contentHash(revised as unknown as JsonValue)).not.toBe(
      contentHash(content as unknown as JsonValue),
    );
  });

  it("rejects an empty revision", () => {
    expect(() => applyProjectSpecRevision(content, {})).toThrow(
      "At least one Project Spec field is required",
    );
  });
});
