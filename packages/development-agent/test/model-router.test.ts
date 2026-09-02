import { describe, expect, it } from "vitest";

import type {
  ModelPolicy,
  ModelProfile,
  ModelProviderPort,
  ModelProviderRequest,
  ModelProviderResult,
} from "@product-woc/development-contracts";

import {
  ModelRoutingService,
  resolveModelRoute,
  type ModelRouteRequest,
} from "../src/model-router.js";

const applicationProfile: ModelProfile = {
  profileId: "application-default",
  providerType: "deterministic",
  model: "fixture-application-v1",
  temperature: 0,
  maxOutputTokens: 4096,
  contextWindow: 8192,
  capabilities: {
    structuredOutput: true,
    toolCalling: false,
    vision: false,
    localOnly: true,
  },
};

const projectProfile: ModelProfile = {
  profileId: "project-default",
  providerType: "openai_compatible",
  model: "project-model-v1",
  endpointRef: "endpoint-project",
  credentialRef: "credential-project",
  temperature: 0.2,
  maxOutputTokens: 8192,
  contextWindow: 16384,
  capabilities: {
    structuredOutput: true,
    toolCalling: true,
    vision: false,
    localOnly: false,
  },
};

const reviewProfile: ModelProfile = {
  profileId: "review-stage",
  providerType: "ollama",
  model: "review-model-v1",
  endpointRef: "endpoint-review",
  temperature: 0,
  maxOutputTokens: 4096,
  contextWindow: 32768,
  capabilities: {
    structuredOutput: true,
    toolCalling: false,
    vision: false,
    localOnly: true,
  },
};

function policy(overrides: Partial<ModelPolicy> = {}): ModelPolicy {
  return {
    policyId: "model-policy-1",
    profiles: [applicationProfile, projectProfile, reviewProfile],
    applicationDefaultProfileId: applicationProfile.profileId,
    projectDefaultProfileId: projectProfile.profileId,
    stageOverrides: [
      {
        scope: "development.review",
        profileId: reviewProfile.profileId,
      },
    ],
    fallback: "pause",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

function routeRequest(overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
  return {
    routeRequestId: "route-request-1",
    snapshotId: "model-snapshot-1",
    agentRunId: "agent-run-1",
    scope: "development.implementation",
    policy: policy(),
    requirements: {
      structuredOutput: true,
      toolCalling: false,
      vision: false,
      localOnly: false,
      minimumContextWindow: 4096,
    },
    contextTokens: 2048,
    promptVersion: "1.0.0",
    toolPolicyVersion: "1.0.0",
    contextHash: "1111111111111111111111111111111111111111111111111111111111111111",
    createdAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

const providerRequest: ModelProviderRequest = {
  requestId: "provider-request-1",
  scope: "development.implementation",
  systemInstructions: "Return a deterministic object.",
  input: { taskId: "task-1" },
  responseFormat: "json",
  contextTokens: 2048,
};

class StubProvider implements ModelProviderPort {
  public calls = 0;

  public constructor(
    public readonly providerType: ModelProfile["providerType"],
    private readonly result: ModelProviderResult,
  ) {}

  public async testConnection(): Promise<{ connected: true; latencyMs: number }> {
    return { connected: true, latencyMs: 0 };
  }

  public async generate(): Promise<ModelProviderResult> {
    this.calls += 1;
    return this.result;
  }
}

class ThrowingProvider implements ModelProviderPort {
  public readonly providerType = "openai_compatible" as const;

  public async testConnection(): Promise<never> {
    throw new Error("unexpected adapter failure");
  }

  public async generate(): Promise<never> {
    throw new Error("unexpected adapter failure");
  }
}

describe("model route precedence and snapshots", () => {
  it("uses application default when no project or stage override exists", () => {
    const route = resolveModelRoute(
      routeRequest({
        policy: policy({
          projectDefaultProfileId: undefined,
          stageOverrides: [],
        }),
      }),
    );

    expect(route.ready && route.profile.profileId).toBe("application-default");
    expect(route.ready && route.snapshot.selectionSource).toBe(
      "application_default",
    );
  });

  it("uses project default, then stage override, then Run override", () => {
    const projectRoute = resolveModelRoute(routeRequest());
    const stageRoute = resolveModelRoute(
      routeRequest({ scope: "development.review" }),
    );
    const runRoute = resolveModelRoute(
      routeRequest({
        scope: "development.review",
        runOverrideProfileId: applicationProfile.profileId,
      }),
    );

    expect(projectRoute.ready && projectRoute.profile.profileId).toBe(
      "project-default",
    );
    expect(stageRoute.ready && stageRoute.profile.profileId).toBe("review-stage");
    expect(runRoute.ready && runRoute.profile.profileId).toBe(
      "application-default",
    );
    expect(runRoute.ready && runRoute.snapshot.selectionSource).toBe(
      "run_override",
    );
  });

  it("locks an immutable snapshot when the source Profile changes", () => {
    const sourcePolicy = policy();
    const route = resolveModelRoute(routeRequest({ policy: sourcePolicy }));
    expect(route.ready).toBe(true);
    if (!route.ready) {
      return;
    }

    projectProfile.model = "changed-after-run";

    expect(route.snapshot.profile.model).toBe("project-model-v1");
    expect(Object.isFrozen(route.snapshot)).toBe(true);
    expect(Object.isFrozen(route.snapshot.profile)).toBe(true);
    projectProfile.model = "project-model-v1";
  });

  it("blocks insufficient capabilities before a Provider call", async () => {
    const provider = new StubProvider("openai_compatible", {
      success: true,
      response: {
        providerRequestId: "unexpected",
        output: {},
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    });
    const service = new ModelRoutingService([provider]);

    const result = await service.invoke(
      routeRequest({
        runOverrideProfileId: applicationProfile.profileId,
        requirements: {
          structuredOutput: true,
          toolCalling: true,
          vision: false,
          localOnly: true,
          minimumContextWindow: 4096,
        },
      }),
      providerRequest,
    );

    expect(result).toMatchObject({
      status: "blocked",
      reason: "tool_calling_unsupported",
    });
    expect(provider.calls).toBe(0);
  });

  it("fails closed when an adapter violates the structured failure contract", async () => {
    const service = new ModelRoutingService([new ThrowingProvider()]);

    await expect(service.invoke(routeRequest(), providerRequest)).resolves.toMatchObject({
      status: "paused",
      failure: {
        code: "unavailable",
        message: "The Provider adapter failed without a structured result",
      },
    });
    await expect(service.testConnection(projectProfile)).resolves.toMatchObject({
      connected: false,
      code: "unavailable",
    });
  });

  it("rejects Provider requests that hide their tool requirement", async () => {
    const provider = new StubProvider("openai_compatible", {
      success: true,
      response: {
        providerRequestId: "unexpected",
        output: {},
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    });
    const service = new ModelRoutingService([provider]);

    const result = await service.invoke(routeRequest(), {
      ...providerRequest,
      tools: [{ name: "hidden-tool" }],
    });

    expect(result).toMatchObject({ status: "blocked", reason: "invalid_policy" });
    expect(provider.calls).toBe(0);
  });
});

describe("explicit model fallback", () => {
  it("pauses without silently calling a configured fallback", async () => {
    const primary = new StubProvider("openai_compatible", {
      success: false,
      code: "unavailable",
      message: "Provider unavailable",
      recoverable: true,
    });
    const fallback = new StubProvider("deterministic", {
      success: true,
      response: {
        providerRequestId: "fallback-request-1",
        output: { ok: true },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    });
    const service = new ModelRoutingService([primary, fallback]);
    const result = await service.invoke(
      routeRequest({
        policy: policy({
          fallback: "explicit_profile",
          fallbackProfileId: applicationProfile.profileId,
        }),
      }),
      providerRequest,
    );

    expect(result).toMatchObject({
      status: "paused",
      fallbackAvailable: true,
    });
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(0);
  });

  it("creates a new Agent Run snapshot and event after confirmation", async () => {
    const primary = new StubProvider("openai_compatible", {
      success: false,
      code: "timeout",
      message: "Provider timed out",
      recoverable: true,
    });
    const fallback = new StubProvider("deterministic", {
      success: true,
      response: {
        providerRequestId: "fallback-request-1",
        output: { ok: true },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    });
    const service = new ModelRoutingService([primary, fallback]);
    const result = await service.invoke(
      routeRequest({
        policy: policy({
          fallback: "explicit_profile",
          fallbackProfileId: applicationProfile.profileId,
        }),
      }),
      providerRequest,
      {
        confirmedBy: "local-user",
        fallbackAgentRunId: "agent-run-fallback-1",
        fallbackSnapshotId: "model-snapshot-fallback-1",
        fallbackEventId: "model-fallback-event-1",
        occurredAt: "2026-08-28T00:01:00.000Z",
      },
    );

    expect(result).toMatchObject({
      status: "completed",
      route: {
        snapshot: {
          agentRunId: "agent-run-fallback-1",
          selectionSource: "fallback",
        },
      },
      fallbackEvent: {
        originalProfileId: "project-default",
        fallbackProfileId: "application-default",
        reason: "provider_timeout",
        confirmedBy: "local-user",
      },
    });
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
  });
});
