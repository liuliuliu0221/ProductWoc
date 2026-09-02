import { describe, expect, it } from "vitest";

import type {
  GoldenStackCapability,
  ProjectSpecVersion,
  TechnicalDesignContent,
} from "@product-woc/planning-contracts";

import {
  applyTechnicalDesignRevision,
  GOLDEN_STACK,
  validateTechnicalDesign,
} from "../src/index.js";

const projectSpec: ProjectSpecVersion = {
  versionId: "spec-1",
  version: 1,
  normalizedContentHash: "a".repeat(64),
  schemaVersion: "2.0.0",
  createdAt: "2026-08-28T00:00:00+08:00",
  title: "Feedback tracker",
  summary: "Collect and triage feedback",
  targetUsers: ["Product managers"],
  coreTasks: ["Capture feedback", "Triage feedback"],
  successMetrics: ["Feedback is triaged within seven days"],
  inScope: ["Feedback capture", "Status changes"],
  outOfScope: ["Public roadmap"],
  requirements: [
    {
      id: "REQ-1",
      title: "Capture feedback",
      description: "Capture feedback with required fields",
      acceptanceCriteria: [{ id: "AC-1", description: "Required fields are validated" }],
      sources: [],
    },
    {
      id: "REQ-2",
      title: "Triage feedback",
      description: "Change the feedback status",
      acceptanceCriteria: [{ id: "AC-2", description: "Status changes are persisted" }],
      sources: [],
    },
  ],
  assumptions: [],
  risks: [],
  openQuestions: [],
  sourceDecisionIds: [],
  sourceArtifactIds: [],
  promptVersion: "1.0.0",
  modelSnapshot: "fixture-model",
};

function validContent(): TechnicalDesignContent {
  const stack = (Object.entries(GOLDEN_STACK) as [GoldenStackCapability, string][]).map(
    ([capability, selection]) => ({
      capability,
      selection,
      status: "compliant" as const,
      rationale: "Uses the ProductFac golden stack",
    }),
  );

  return {
    architectureSummary: "A modular authenticated web application backed by PostgreSQL.",
    stack,
    modules: [
      {
        id: "module-feedback",
        name: "Feedback module",
        responsibilities: ["Capture and triage feedback"],
        dependsOn: [],
      },
    ],
    dataEntities: [
      {
        id: "entity-feedback",
        name: "Feedback",
        purpose: "Stores submitted feedback and triage state",
        sensitiveData: false,
        lifecycle: "Created on submission and retained until workspace deletion",
      },
    ],
    apis: [
      {
        id: "api-feedback-create",
        method: "POST",
        path: "/api/feedback",
        purpose: "Create feedback",
        authentication: "required",
        requirementIds: ["REQ-1"],
      },
    ],
    permissionRules: [
      {
        id: "permission-feedback",
        actor: "Workspace member",
        action: "manage",
        resource: "Feedback",
        condition: "The feedback belongs to the actor workspace",
      },
    ],
    stateLifecycles: [
      {
        entity: "Feedback",
        states: ["new", "triaged"],
        transitions: [{ from: "new", to: "triaged", trigger: "Member triages feedback" }],
      },
    ],
    designItems: [
      {
        id: "DES-1",
        title: "Feedback intake",
        description: "Authenticated API and form validate feedback",
        requirementIds: ["REQ-1"],
        moduleIds: ["module-feedback"],
      },
      {
        id: "DES-2",
        title: "Feedback state",
        description: "Status transitions are validated and persisted",
        requirementIds: ["REQ-2"],
        moduleIds: ["module-feedback"],
      },
    ],
    traceability: [
      { requirementId: "REQ-1", disposition: "designed", designItemIds: ["DES-1"] },
      { requirementId: "REQ-2", disposition: "designed", designItemIds: ["DES-2"] },
    ],
    technicalDecisions: [],
    platformCapabilities: [
      {
        capability: "planning-v2-persistence",
        status: "planned",
        evidence: "ProductFac P1-02 and Gate G1 are prerequisites",
      },
    ],
    errorHandling: ["Return stable error codes and preserve failed inputs for retry"],
    securityConsiderations: ["Enforce Workspace RBAC on every server query"],
    privacyConsiderations: ["Keep feedback private to its workspace"],
    testStrategy: ["Unit test rules and integration test authenticated APIs"],
    observability: ["Record request IDs, latency, and redacted error summaries"],
    migrationStrategy: "Use additive reviewed ProductFac migrations.",
    rollbackStrategy: "Disable the feature and retain additive data.",
    dependencies: ["ProductFac Gate G1"],
    risks: ["Platform integration is blocked until Gate G1"],
  };
}

describe("Technical Design validation", () => {
  it("accepts full golden-stack compliance and complete traceability", () => {
    expect(
      validateTechnicalDesign(validContent(), projectSpec, {
        availablePlatformCapabilities: [],
      }),
    ).toEqual({
      valid: true,
      needsUserAction: false,
      issues: [],
      requirementCoverage: 1,
    });
  });

  it("routes a golden-stack deviation to user confirmation", () => {
    const content = validContent();
    content.stack[0] = {
      capability: "web_framework",
      selection: "Next.js 16",
      status: "requires_confirmation",
      rationale: "A different UI runtime was proposed",
      proposedAlternative: "SvelteKit",
    };
    const result = validateTechnicalDesign(content, projectSpec, {
      availablePlatformCapabilities: [],
    });

    expect(result.valid).toBe(false);
    expect(result.needsUserAction).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "stack_deviation_requires_confirmation" }),
    );
  });

  it("rejects missing traces and unverified platform claims", () => {
    const content = validContent();
    content.traceability = content.traceability.slice(0, 1);
    content.platformCapabilities = [
      {
        capability: "planning-v2-persistence",
        status: "available",
        evidence: "Assumed by the model",
      },
    ];
    const result = validateTechnicalDesign(content, projectSpec, {
      availablePlatformCapabilities: [],
    });

    expect(result.valid).toBe(false);
    expect(result.requirementCoverage).toBe(0.5);
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "missing_requirement_trace",
        "unverified_platform_capability",
      ]),
    );
  });

  it("rejects secret-like material", () => {
    const content = validContent();
    content.dependencies = ["api_key=super-secret-production-value"];
    const result = validateTechnicalDesign(content, projectSpec, {
      availablePlatformCapabilities: [],
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "secret_material_detected" }),
    );
  });

  it("accepts a confirmed golden-stack exception", () => {
    const content = validContent();
    content.stack[0] = {
      capability: "web_framework",
      selection: "SvelteKit",
      status: "approved_exception",
      rationale: "The product owner accepted the migration cost",
      confirmationDecisionId: "decision-stack-1",
    };
    const result = validateTechnicalDesign(content, projectSpec, {
      availablePlatformCapabilities: [],
      confirmedDecisionIds: ["decision-stack-1"],
    });

    expect(result.valid).toBe(true);
  });

  it("creates complete new content from a single-field revision", () => {
    const content = validContent();
    const revised = applyTechnicalDesignRevision(content, {
      risks: [...content.risks, "A new reviewed integration risk"],
    });

    expect(revised).not.toBe(content);
    expect(revised.risks).toContain("A new reviewed integration risk");
    expect(content.risks).not.toContain("A new reviewed integration risk");
  });
});
