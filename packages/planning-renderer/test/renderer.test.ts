import { describe, expect, it } from "vitest";

import type { ProjectSpecVersion } from "@product-woc/planning-contracts";

import {
  diffJson,
  renderProjectSpecMarkdown,
  summarizeProjectSpec,
} from "../src/index.js";

const fixture: ProjectSpecVersion = {
  versionId: "spec-1",
  version: 1,
  normalizedContentHash: "a".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-27T08:00:00+08:00",
  title: "Feedback tracker",
  summary: "Collect and triage customer feedback.",
  targetUsers: ["Product managers"],
  coreTasks: ["Capture feedback"],
  successMetrics: ["Feedback is triaged weekly"],
  inScope: ["Feedback intake"],
  outOfScope: ["Public roadmap"],
  requirements: [
    {
      id: "REQ-1",
      title: "Capture feedback",
      description: "A user can record customer feedback.",
      acceptanceCriteria: [
        { id: "AC-1", description: "Required fields are validated." },
      ],
      sources: [],
    },
  ],
  assumptions: ["Workspace members are trusted collaborators"],
  risks: ["Duplicate submissions"],
  openQuestions: [],
  sourceDecisionIds: ["decision-1"],
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-model",
};

describe("project spec renderer", () => {
  it("derives Markdown without changing authoritative content", () => {
    expect(renderProjectSpecMarkdown(fixture)).toContain("# Feedback tracker");
    expect(renderProjectSpecMarkdown(fixture)).toContain("REQ-1: Capture feedback");
  });

  it("creates a compact decision summary", () => {
    expect(summarizeProjectSpec(fixture)).toMatchObject({
      title: "Feedback tracker",
      inScope: ["Feedback intake"],
      outOfScope: ["Public roadmap"],
      openQuestions: [],
    });
  });
});

describe("structured diff", () => {
  it("reports stable field-level operations", () => {
    expect(
      diffJson(
        { summary: "Old", scope: { in: ["A"], out: ["B"] } },
        { summary: "New", scope: { in: ["A", "C"] }, title: "Tracker" },
      ),
    ).toEqual([
      {
        operation: "replace",
        path: "/scope/in",
        before: ["A"],
        after: ["A", "C"],
      },
      { operation: "remove", path: "/scope/out", before: ["B"] },
      { operation: "replace", path: "/summary", before: "Old", after: "New" },
      { operation: "add", path: "/title", after: "Tracker" },
    ]);
  });

  it("ignores object insertion order", () => {
    expect(diffJson({ b: 2, a: 1 }, { a: 1, b: 2 })).toEqual([]);
  });
});
