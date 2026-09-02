import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  technicalDesignContentSchema,
  technicalDesignVersionSchema,
} from "@product-woc/planning-contracts";

import {
  renderTechnicalDesignMarkdown,
  summarizeTechnicalDesign,
} from "../src/index.js";

const fixtureUrl = new URL(
  "../../../fixtures/technical-design-valid-v1.json",
  import.meta.url,
);
const content = technicalDesignContentSchema.parse(
  JSON.parse(readFileSync(fixtureUrl, "utf8")),
);
const version = technicalDesignVersionSchema.parse({
  ...content,
  versionId: "design-1",
  version: 1,
  normalizedContentHash: "b".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:00:00+08:00",
  projectSpecVersionId: "spec-1",
  projectSpecHash: "a".repeat(64),
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-architect",
});

describe("Technical Design renderer", () => {
  it("renders the upstream binding, stack, modules, and traceability", () => {
    const markdown = renderTechnicalDesignMarkdown(version);

    expect(markdown).toContain("Bound Project Spec: spec-1");
    expect(markdown).toContain("web_framework: Next.js 16");
    expect(markdown).toContain("REQ-1: designed → DES-1");
  });

  it("creates a compact approval summary", () => {
    expect(summarizeTechnicalDesign(version)).toMatchObject({
      modules: ["Core product module"],
      stackExceptions: [],
      decisionsRequiringConfirmation: [],
      risks: [
        "Durable production adapters are intentionally outside the standalone runtime",
      ],
    });
  });
});
