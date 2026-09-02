import { createHash } from "node:crypto";

import {
  modelCapabilityRequirementSchema,
  modelFallbackEventSchema,
  modelPolicySchema,
  modelProfileSchema,
  modelRunSnapshotSchema,
  type ModelCapabilityRequirement,
  type ModelConnectionResult,
  type ModelFallbackEvent,
  type ModelPolicy,
  type ModelProfile,
  type ModelProviderFailureCode,
  type ModelProviderPort,
  type ModelProviderRequest,
  type ModelProviderResult,
  type ModelProviderResponse,
  type ModelRunSnapshot,
  type ModelSelectionSource,
  type ModelStageScope,
} from "@product-woc/development-contracts";

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Model configuration cannot contain non-finite numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Model configuration must be JSON-compatible");
}

function configurationHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

export interface ModelRouteRequest {
  routeRequestId: string;
  snapshotId: string;
  agentRunId: string;
  scope: ModelStageScope;
  policy: ModelPolicy;
  requirements: ModelCapabilityRequirement;
  contextTokens: number;
  promptVersion: string;
  toolPolicyVersion: string;
  contextHash: string;
  createdAt: string;
  runOverrideProfileId?: string;
}

export type ModelRouteBlockReason =
  | "invalid_policy"
  | "unknown_profile"
  | "structured_output_unsupported"
  | "tool_calling_unsupported"
  | "vision_unsupported"
  | "local_only_required"
  | "context_window_insufficient";

export type ModelRouteResult =
  | {
      ready: true;
      profile: Readonly<ModelProfile>;
      snapshot: Readonly<ModelRunSnapshot>;
    }
  | {
      ready: false;
      reason: ModelRouteBlockReason;
      message: string;
    };

export interface ModelFallbackConfirmation {
  confirmedBy: string;
  fallbackAgentRunId: string;
  fallbackSnapshotId: string;
  fallbackEventId: string;
  occurredAt: string;
}

export type ModelInvocationOutcome =
  | {
      status: "completed";
      route: ModelRouteResult & { ready: true };
      response: ModelProviderResponse;
      fallbackEvent?: Readonly<ModelFallbackEvent>;
    }
  | {
      status: "blocked";
      reason: ModelRouteBlockReason;
      message: string;
    }
  | {
      status: "paused";
      route?: ModelRouteResult & { ready: true };
      failure: {
        code: ModelProviderFailureCode;
        message: string;
        recoverable: boolean;
      };
      fallbackAvailable: boolean;
      fallbackEvent?: Readonly<ModelFallbackEvent>;
    };

interface SelectedProfile {
  profile: ModelProfile;
  source: ModelSelectionSource;
}

function selectProfile(
  policy: ModelPolicy,
  scope: ModelStageScope,
  runOverrideProfileId?: string,
): SelectedProfile | undefined {
  const stageOverride = policy.stageOverrides.find(
    (override) => override.scope === scope,
  );
  const profileId =
    runOverrideProfileId ??
    stageOverride?.profileId ??
    policy.projectDefaultProfileId ??
    policy.applicationDefaultProfileId;
  const source: ModelSelectionSource = runOverrideProfileId
    ? "run_override"
    : stageOverride
      ? "stage_override"
      : policy.projectDefaultProfileId
        ? "project_default"
        : "application_default";
  const profile = policy.profiles.find((candidate) => candidate.profileId === profileId);
  return profile ? { profile, source } : undefined;
}

function capabilityFailure(
  profile: ModelProfile,
  requirements: ModelCapabilityRequirement,
  contextTokens: number,
): Extract<ModelRouteResult, { ready: false }> | undefined {
  if (requirements.structuredOutput && !profile.capabilities.structuredOutput) {
    return {
      ready: false,
      reason: "structured_output_unsupported",
      message: "The selected model does not support structured output",
    };
  }
  if (requirements.toolCalling && !profile.capabilities.toolCalling) {
    return {
      ready: false,
      reason: "tool_calling_unsupported",
      message: "The selected model does not support tool calling",
    };
  }
  if (requirements.vision && !profile.capabilities.vision) {
    return {
      ready: false,
      reason: "vision_unsupported",
      message: "The selected model does not support vision input",
    };
  }
  if (requirements.localOnly && !profile.capabilities.localOnly) {
    return {
      ready: false,
      reason: "local_only_required",
      message: "The selected model does not satisfy the local-only policy",
    };
  }
  const requiredWindow = Math.max(
    requirements.minimumContextWindow,
    contextTokens,
  );
  if (!profile.contextWindow || profile.contextWindow < requiredWindow) {
    return {
      ready: false,
      reason: "context_window_insufficient",
      message: "The selected model context window is smaller than the required input",
    };
  }
  return undefined;
}

function snapshotFor(
  request: ModelRouteRequest,
  policy: ModelPolicy,
  selected: SelectedProfile,
  overrides?: {
    snapshotId: string;
    agentRunId: string;
    selectionSource: ModelSelectionSource;
    createdAt: string;
  },
): Readonly<ModelRunSnapshot> {
  const policyHash = configurationHash(policy);
  const profileHash = configurationHash(selected.profile);
  const snapshot = modelRunSnapshotSchema.parse({
    snapshotId: overrides?.snapshotId ?? request.snapshotId,
    routeRequestId: request.routeRequestId,
    agentRunId: overrides?.agentRunId ?? request.agentRunId,
    policyId: policy.policyId,
    scope: request.scope,
    selectionSource: overrides?.selectionSource ?? selected.source,
    profile: selected.profile,
    policyHash,
    profileHash,
    configurationHash: configurationHash({
      policyHash,
      profileHash,
      scope: request.scope,
      selectionSource: overrides?.selectionSource ?? selected.source,
      promptVersion: request.promptVersion,
      toolPolicyVersion: request.toolPolicyVersion,
      contextHash: request.contextHash,
    }),
    promptVersion: request.promptVersion,
    toolPolicyVersion: request.toolPolicyVersion,
    contextHash: request.contextHash,
    createdAt: overrides?.createdAt ?? request.createdAt,
  });
  return deepFreeze(snapshot);
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Invalid model policy";
}

export function resolveModelRoute(request: ModelRouteRequest): ModelRouteResult {
  const parsedPolicy = modelPolicySchema.safeParse(request.policy);
  const parsedRequirements = modelCapabilityRequirementSchema.safeParse(
    request.requirements,
  );
  if (!parsedPolicy.success || !parsedRequirements.success) {
    return {
      ready: false,
      reason: "invalid_policy",
      message: failureMessage(
        parsedPolicy.success ? parsedRequirements.error : parsedPolicy.error,
      ),
    };
  }
  const selected = selectProfile(
    parsedPolicy.data,
    request.scope,
    request.runOverrideProfileId,
  );
  if (!selected) {
    return {
      ready: false,
      reason: "unknown_profile",
      message: "The requested Model Profile does not exist",
    };
  }
  const blocked = capabilityFailure(
    selected.profile,
    parsedRequirements.data,
    request.contextTokens,
  );
  if (blocked) {
    return blocked;
  }
  return {
    ready: true,
    profile: deepFreeze(modelProfileSchema.parse(selected.profile)),
    snapshot: snapshotFor(request, parsedPolicy.data, selected),
  };
}

async function safelyGenerate(
  provider: ModelProviderPort,
  profile: ModelProfile,
  request: ModelProviderRequest,
): Promise<ModelProviderResult> {
  try {
    return await provider.generate(profile, request);
  } catch {
    return {
      success: false,
      code: "unavailable",
      message: "The Provider adapter failed without a structured result",
      recoverable: true,
    };
  }
}

export class ModelRoutingService {
  private readonly providers: ReadonlyMap<
    ModelProfile["providerType"],
    ModelProviderPort
  >;

  public constructor(providers: readonly ModelProviderPort[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.providerType, provider]),
    );
  }

  public async testConnection(profile: ModelProfile): Promise<ModelConnectionResult> {
    const parsed = modelProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return {
        connected: false,
        code: "configuration_error",
        message: "The Model Profile is invalid",
        recoverable: true,
      };
    }
    const provider = this.providers.get(parsed.data.providerType);
    if (!provider) {
      return {
          connected: false,
          code: "configuration_error",
          message: "No adapter is registered for the selected provider type",
          recoverable: true,
        };
    }
    try {
      return await provider.testConnection(parsed.data);
    } catch {
      return {
        connected: false,
        code: "unavailable",
        message: "The Provider adapter connection test failed unexpectedly",
        recoverable: true,
      };
    }
  }

  public async invoke(
    routeRequest: ModelRouteRequest,
    providerRequest: ModelProviderRequest,
    fallbackConfirmation?: ModelFallbackConfirmation,
  ): Promise<ModelInvocationOutcome> {
    const route = resolveModelRoute(routeRequest);
    if (!route.ready) {
      return { status: "blocked", reason: route.reason, message: route.message };
    }
    if (
      providerRequest.scope !== routeRequest.scope ||
      providerRequest.contextTokens !== routeRequest.contextTokens ||
      (providerRequest.responseFormat === "json" &&
        !routeRequest.requirements.structuredOutput) ||
      (Boolean(providerRequest.tools?.length) &&
        !routeRequest.requirements.toolCalling)
    ) {
      return {
        status: "blocked",
        reason: "invalid_policy",
        message: "The Provider request does not match the locked model route",
      };
    }
    const provider = this.providers.get(route.profile.providerType);
    if (!provider) {
      return {
        status: "paused",
        route,
        failure: {
          code: "configuration_error",
          message: "No adapter is registered for the selected provider type",
          recoverable: true,
        },
        fallbackAvailable: false,
      };
    }

    const result = await safelyGenerate(provider, route.profile, providerRequest);
    if (result.success) {
      return { status: "completed", route, response: result.response };
    }

    const policy = modelPolicySchema.parse(routeRequest.policy);
    const canFallback =
      (result.code === "unavailable" || result.code === "timeout") &&
      policy.fallback === "explicit_profile" &&
      Boolean(policy.fallbackProfileId) &&
      policy.fallbackProfileId !== route.profile.profileId;
    if (!canFallback || !fallbackConfirmation) {
      return {
        status: "paused",
        route,
        failure: result,
        fallbackAvailable: canFallback,
      };
    }

    const fallbackProfile = policy.profiles.find(
      (candidate) => candidate.profileId === policy.fallbackProfileId,
    );
    if (!fallbackProfile) {
      return {
        status: "paused",
        route,
        failure: {
          code: "configuration_error",
          message: "The configured fallback Model Profile does not exist",
          recoverable: true,
        },
        fallbackAvailable: false,
      };
    }
    const blocked = capabilityFailure(
      fallbackProfile,
      routeRequest.requirements,
      routeRequest.contextTokens,
    );
    if (blocked) {
      return {
        status: "paused",
        route,
        failure: {
          code: "configuration_error",
          message: blocked.message,
          recoverable: true,
        },
        fallbackAvailable: false,
      };
    }

    const fallbackRoute: ModelRouteResult & { ready: true } = {
      ready: true,
      profile: deepFreeze(modelProfileSchema.parse(fallbackProfile)),
      snapshot: snapshotFor(
        routeRequest,
        policy,
        { profile: fallbackProfile, source: "fallback" },
        {
          snapshotId: fallbackConfirmation.fallbackSnapshotId,
          agentRunId: fallbackConfirmation.fallbackAgentRunId,
          selectionSource: "fallback",
          createdAt: fallbackConfirmation.occurredAt,
        },
      ),
    };
    const fallbackEvent = deepFreeze(
      modelFallbackEventSchema.parse({
        fallbackEventId: fallbackConfirmation.fallbackEventId,
        routeRequestId: routeRequest.routeRequestId,
        fromAgentRunId: routeRequest.agentRunId,
        toAgentRunId: fallbackConfirmation.fallbackAgentRunId,
        originalProfileId: route.profile.profileId,
        fallbackProfileId: fallbackProfile.profileId,
        reason:
          result.code === "timeout" ? "provider_timeout" : "provider_unavailable",
        confirmedBy: fallbackConfirmation.confirmedBy,
        occurredAt: fallbackConfirmation.occurredAt,
      }),
    );
    const fallbackProvider = this.providers.get(fallbackProfile.providerType);
    if (!fallbackProvider) {
      return {
        status: "paused",
        route: fallbackRoute,
        failure: {
          code: "configuration_error",
          message: "No adapter is registered for the fallback provider type",
          recoverable: true,
        },
        fallbackAvailable: false,
        fallbackEvent,
      };
    }
    const fallbackResult = await safelyGenerate(
      fallbackProvider,
      fallbackRoute.profile,
      providerRequest,
    );
    return fallbackResult.success
      ? {
          status: "completed",
          route: fallbackRoute,
          response: fallbackResult.response,
          fallbackEvent,
        }
      : {
          status: "paused",
          route: fallbackRoute,
          failure: fallbackResult,
          fallbackAvailable: false,
          fallbackEvent,
        };
  }
}
