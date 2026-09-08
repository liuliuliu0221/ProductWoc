import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  modelAvailabilityViewSchema,
  modelStageScopeSchema,
  productWocRuntimeConfigSchema,
  type ModelAvailabilityStatus,
  type ModelAvailabilityView,
  type ModelProfile,
  type ProductWocRuntimeConfig,
} from "@product-woc/development-contracts";

export type { ModelAvailabilityView } from "@product-woc/development-contracts";

export const DEFAULT_RUNTIME_CONFIG_FILE = "productwoc.config.json";
export const PRODUCT_WOC_CONFIG_PATH_ENV = "PRODUCT_WOC_CONFIG_PATH";
export const RUNTIME_CONFIG_MAX_BYTES = 256 * 1024;

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface RuntimeConfigDiagnostic {
  severity: "error" | "warning";
  code:
    | "config_missing"
    | "config_not_file"
    | "config_too_large"
    | "config_read_failed"
    | "invalid_json"
    | "schema_invalid"
    | "provider_reference_required"
    | "provider_reference_forbidden"
    | "reference_scheme_unsupported"
    | "environment_value_missing"
    | "endpoint_invalid";
  message: string;
  path?: string;
  operatorHint?: string;
}

export interface RuntimeConfigOperatorSnapshot {
  schemaVersion: "1";
  sourcePath: string;
  configurationHash: string;
  loadedAt: string;
  runtimeMode: ProductWocRuntimeConfig["runtimeMode"];
  configurationAuthority: "developer_operator";
  applicationDefaultProfileId: string;
  profiles: readonly {
    profileId: string;
    providerType: ModelProfile["providerType"];
    model: string;
    capabilities: ModelProfile["capabilities"];
  }[];
  stageOverrides: readonly Readonly<
    ProductWocRuntimeConfig["stageOverrides"][number]
  >[];
  fallbackPolicy: ProductWocRuntimeConfig["fallbackPolicy"];
  fallbackProfileId?: string;
}

export interface RuntimeConfigurationState {
  sourcePath: string;
  valid: boolean;
  readyForGeneration: boolean;
  availability: ModelAvailabilityView;
  diagnostics: readonly RuntimeConfigDiagnostic[];
  config?: ProductWocRuntimeConfig;
  configurationHash?: string;
  operatorSnapshot?: RuntimeConfigOperatorSnapshot;
}

export interface ResolvedProfileEnvironment {
  endpoint?: string;
  credential?: string;
}

export class RuntimeConfigResolutionError extends Error {
  public constructor(public readonly diagnostics: readonly RuntimeConfigDiagnostic[]) {
    super(diagnostics.map(({ message }) => message).join("; "));
    this.name = "RuntimeConfigResolutionError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export function runtimeConfigurationHash(config: ProductWocRuntimeConfig): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

export function discoverRuntimeConfigPath(options: {
  cwd?: string;
  configPath?: string;
  environment?: RuntimeEnvironment;
} = {}): string {
  const cwd = resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const configured = options.configPath ??
    environment[PRODUCT_WOC_CONFIG_PATH_ENV];
  if (!configured) return join(cwd, DEFAULT_RUNTIME_CONFIG_FILE);
  return isAbsolute(configured) ? resolve(configured) : resolve(cwd, configured);
}

function missingAvailability(): ModelAvailabilityView {
  return modelAvailabilityViewSchema.parse({
    configurationAuthority: "developer_operator",
    webEditable: false,
    status: "unavailable",
    stages: modelStageScopeSchema.options.map((scope) => ({
      scope,
      status: "unavailable",
    })),
  });
}

function referenceName(
  reference: string | undefined,
  path: string,
  diagnostics: RuntimeConfigDiagnostic[],
): string | undefined {
  if (!reference) return undefined;
  const match = /^env:([A-Z][A-Z0-9_]*)$/.exec(reference);
  if (!match) {
    diagnostics.push({
      severity: "error",
      code: "reference_scheme_unsupported",
      path,
      message: `${path} must use env:UPPER_CASE_NAME`,
    });
  }
  return match?.[1];
}

function inspectProfile(
  profile: ModelProfile,
  environment: RuntimeEnvironment,
): RuntimeConfigDiagnostic[] {
  const diagnostics: RuntimeConfigDiagnostic[] = [];
  const base = `profiles.${profile.profileId}`;
  if (profile.providerType === "deterministic") {
    for (const [field, value] of [
      ["endpointRef", profile.endpointRef],
      ["credentialRef", profile.credentialRef],
    ] as const) {
      if (value) diagnostics.push({
        severity: "error",
        code: "provider_reference_forbidden",
        path: `${base}.${field}`,
        message: `${base}.${field} is forbidden for deterministic profiles`,
      });
    }
    return diagnostics;
  }

  if (!profile.endpointRef) diagnostics.push({
    severity: "error",
    code: "provider_reference_required",
    path: `${base}.endpointRef`,
    message: `${base}.endpointRef is required`,
  });
  if (profile.providerType === "openai_compatible" && !profile.credentialRef) {
    diagnostics.push({
      severity: "error",
      code: "provider_reference_required",
      path: `${base}.credentialRef`,
      message: `${base}.credentialRef is required`,
    });
  }

  const endpointName = referenceName(
    profile.endpointRef,
    `${base}.endpointRef`,
    diagnostics,
  );
  const credentialName = referenceName(
    profile.credentialRef,
    `${base}.credentialRef`,
    diagnostics,
  );
  const endpoint = endpointName ? environment[endpointName] : undefined;
  if (endpointName && !endpoint?.trim()) diagnostics.push({
    severity: "error",
    code: "environment_value_missing",
    path: `${base}.endpointRef`,
    message: "The referenced endpoint environment variable is not set",
    operatorHint: `Set ${endpointName} before starting ProductWoc`,
  });
  if (endpoint?.trim()) {
    try {
      const parsed = new URL(endpoint);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("invalid endpoint");
      }
    } catch {
      diagnostics.push({
        severity: "error",
        code: "endpoint_invalid",
        path: `${base}.endpointRef`,
        message: "The referenced endpoint must be an HTTP(S) URL without embedded credentials",
        operatorHint: `Check ${endpointName}`,
      });
    }
  }
  if (credentialName && !environment[credentialName]?.trim()) diagnostics.push({
    severity: "error",
    code: "environment_value_missing",
    path: `${base}.credentialRef`,
    message: "The referenced credential environment variable is not set",
    operatorHint: `Set ${credentialName} before starting ProductWoc`,
  });
  return diagnostics;
}

function availabilityFrom(
  config: ProductWocRuntimeConfig,
  profileDiagnostics: ReadonlyMap<string, readonly RuntimeConfigDiagnostic[]>,
): ModelAvailabilityView {
  const profiles = new Map(config.profiles.map((profile) => [profile.profileId, profile]));
  const stages = modelStageScopeSchema.options.map((scope) => {
    const override = config.stageOverrides.find((candidate) => candidate.scope === scope);
    const profile = profiles.get(override?.profileId ?? config.applicationDefaultProfileId)!;
    const unavailable = (profileDiagnostics.get(profile.profileId)?.length ?? 0) > 0;
    return {
      scope,
      providerType: profile.providerType,
      modelLabel: profile.model,
      selectionSource: override ? "stage_override" as const : "application_default" as const,
      status: unavailable
        ? "unavailable" as const
        : profile.providerType === "deterministic"
          ? "test_mode" as const
          : "configured" as const,
    };
  });
  const statuses = new Set(stages.map(({ status }) => status));
  const status: ModelAvailabilityStatus = statuses.size === 1
    ? (stages[0]?.status ?? "unavailable")
    : "degraded";
  return modelAvailabilityViewSchema.parse({
    configurationAuthority: "developer_operator",
    webEditable: false,
    status,
    stages,
  });
}

function operatorSnapshotFrom(
  sourcePath: string,
  configurationHash: string,
  loadedAt: string,
  config: ProductWocRuntimeConfig,
): RuntimeConfigOperatorSnapshot {
  return Object.freeze({
    schemaVersion: "1",
    sourcePath,
    configurationHash,
    loadedAt,
    runtimeMode: config.runtimeMode,
    configurationAuthority: "developer_operator",
    applicationDefaultProfileId: config.applicationDefaultProfileId,
    profiles: Object.freeze(config.profiles.map((profile) => Object.freeze({
      profileId: profile.profileId,
      providerType: profile.providerType,
      model: profile.model,
      capabilities: Object.freeze({ ...profile.capabilities }),
    }))),
    stageOverrides: Object.freeze(config.stageOverrides.map((override) => Object.freeze({ ...override }))),
    fallbackPolicy: config.fallbackPolicy,
    ...(config.fallbackProfileId ? { fallbackProfileId: config.fallbackProfileId } : {}),
  });
}

export async function loadRuntimeConfiguration(options: {
  cwd?: string;
  configPath?: string;
  environment?: RuntimeEnvironment;
  loadedAt?: string;
} = {}): Promise<RuntimeConfigurationState> {
  const sourcePath = discoverRuntimeConfigPath(options);
  const environment = options.environment ?? process.env;
  let handle;
  try {
    handle = await open(sourcePath, "r");
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      return {
        sourcePath,
        valid: false,
        readyForGeneration: false,
        availability: missingAvailability(),
        diagnostics: [{
          severity: "error",
          code: "config_not_file",
          message: "Runtime configuration path is not a regular file",
        }],
      };
    }
    if (metadata.size > RUNTIME_CONFIG_MAX_BYTES) {
      return {
        sourcePath,
        valid: false,
        readyForGeneration: false,
        availability: missingAvailability(),
        diagnostics: [{
          severity: "error",
          code: "config_too_large",
          message: `Runtime configuration exceeds ${RUNTIME_CONFIG_MAX_BYTES} bytes`,
        }],
      };
    }
    const content = await handle.readFile({ encoding: "utf8" });
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return {
        sourcePath,
        valid: false,
        readyForGeneration: false,
        availability: missingAvailability(),
        diagnostics: [{
          severity: "error",
          code: "invalid_json",
          message: "Runtime configuration is not valid JSON",
        }],
      };
    }
    const parsed = productWocRuntimeConfigSchema.safeParse(value);
    if (!parsed.success) {
      return {
        sourcePath,
        valid: false,
        readyForGeneration: false,
        availability: missingAvailability(),
        diagnostics: parsed.error.issues.map((issue) => ({
          severity: "error" as const,
          code: "schema_invalid" as const,
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    }

    const config = deepFreeze(parsed.data);
    const profileDiagnostics = new Map(
      config.profiles.map((profile) => [
        profile.profileId,
        inspectProfile(profile, environment),
      ]),
    );
    const diagnostics = [...profileDiagnostics.values()].flat();
    const resolvedAvailability = availabilityFrom(config, profileDiagnostics);
    const availability = diagnostics.length > 0 &&
      resolvedAvailability.status !== "unavailable"
      ? { ...resolvedAvailability, status: "degraded" as const }
      : resolvedAvailability;
    const configurationHash = runtimeConfigurationHash(config);
    const loadedAt = options.loadedAt ?? new Date().toISOString();
    return {
      sourcePath,
      valid: diagnostics.length === 0,
      readyForGeneration:
        diagnostics.length === 0 &&
        ["configured", "test_mode"].includes(availability.status),
      availability,
      diagnostics,
      config,
      configurationHash,
      operatorSnapshot: operatorSnapshotFrom(
        sourcePath,
        configurationHash,
        loadedAt,
        config,
      ),
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return {
      sourcePath,
      valid: false,
      readyForGeneration: false,
      availability: missingAvailability(),
      diagnostics: [{
        severity: "error",
        code: missing ? "config_missing" : "config_read_failed",
        message: missing
          ? `Runtime configuration was not found at ${sourcePath}`
          : "Runtime configuration could not be read",
      }],
    };
  } finally {
    await handle?.close();
  }
}

export function resolveRuntimeProfileEnvironment(
  profile: ModelProfile,
  environment: RuntimeEnvironment = process.env,
): ResolvedProfileEnvironment {
  const diagnostics = inspectProfile(profile, environment);
  if (diagnostics.length > 0) throw new RuntimeConfigResolutionError(diagnostics);
  const endpointName = profile.endpointRef?.slice("env:".length);
  const credentialName = profile.credentialRef?.slice("env:".length);
  return {
    ...(endpointName ? { endpoint: environment[endpointName]!.trim() } : {}),
    ...(credentialName ? { credential: environment[credentialName]!.trim() } : {}),
  };
}

export function createDeterministicTestRuntimeConfigurationState(
  loadedAt = "2000-01-01T00:00:00.000Z",
): RuntimeConfigurationState {
  const config = deepFreeze(productWocRuntimeConfigSchema.parse({
    schemaVersion: "1",
    configurationAuthority: "developer_operator",
    runtimeMode: "test",
    profiles: [{
      profileId: "deterministic-local",
      providerType: "deterministic",
      model: "product-woc-fixture-v1",
      temperature: 0,
      maxOutputTokens: 4096,
      contextWindow: 32768,
      capabilities: {
        structuredOutput: true,
        toolCalling: false,
        vision: false,
        localOnly: true,
      },
    }],
    applicationDefaultProfileId: "deterministic-local",
    stageOverrides: [],
    fallbackPolicy: "pause",
  }));
  const sourcePath = "in-memory:test-runtime-config";
  const configurationHash = runtimeConfigurationHash(config);
  const availability = availabilityFrom(
    config,
    new Map([["deterministic-local", []]]),
  );
  return {
    sourcePath,
    valid: true,
    readyForGeneration: true,
    availability,
    diagnostics: [],
    config,
    configurationHash,
    operatorSnapshot: operatorSnapshotFrom(
      sourcePath,
      configurationHash,
      loadedAt,
      config,
    ),
  };
}
