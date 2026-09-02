import { describe, expect, it } from "vitest";

import type {
  ModelPolicy,
  ModelProviderRequest,
} from "@product-woc/development-contracts";
import { DeterministicModelProvider } from "@product-woc/development-adapters";
import {
  ModelRoutingService,
  type ModelRouteRequest,
} from "@product-woc/development-agent";

const policy: ModelPolicy = {
  policyId: "gate-p3-b-policy",
  profiles: [
    {
      profileId: "gate-p3-b-deterministic",
      providerType: "deterministic",
      model: "fixture-development-v1",
      temperature: 0,
      maxOutputTokens: 4096,
      contextWindow: 8192,
      capabilities: {
        structuredOutput: true,
        toolCalling: false,
        vision: false,
        localOnly: true,
      },
    },
  ],
  applicationDefaultProfileId: "gate-p3-b-deterministic",
  stageOverrides: [],
  fallback: "pause",
  createdAt: "2026-08-28T00:00:00.000Z",
};

const routeRequest: ModelRouteRequest = {
  routeRequestId: "gate-p3-b-route",
  snapshotId: "gate-p3-b-snapshot",
  agentRunId: "gate-p3-b-agent-run",
  scope: "development.implementation",
  policy,
  requirements: {
    structuredOutput: true,
    toolCalling: false,
    vision: false,
    localOnly: true,
    minimumContextWindow: 4096,
  },
  contextTokens: 512,
  promptVersion: "1.0.0",
  toolPolicyVersion: "1.0.0",
  contextHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  createdAt: "2026-08-28T00:00:00.000Z",
};

const providerRequest: ModelProviderRequest = {
  requestId: "gate-p3-b-provider-request",
  scope: "development.implementation",
  systemInstructions: "Return the deterministic Gate P3-B fixture.",
  input: { taskId: "fixture-task-1" },
  responseFormat: "json",
  contextTokens: 512,
};

describe("Gate P3-B offline route", () => {
  it("routes and invokes the deterministic Provider without network access", async () => {
    const service = new ModelRoutingService([new DeterministicModelProvider()]);

    await expect(service.invoke(routeRequest, providerRequest)).resolves.toMatchObject({
      status: "completed",
      route: {
        snapshot: {
          selectionSource: "application_default",
          profile: { providerType: "deterministic" },
        },
      },
      response: {
        output: {
          fixture: "product-woc-development-deterministic-v1",
          scope: "development.implementation",
        },
      },
    });
  });
});
