import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  modelPolicySchema,
  modelStageScopeSchema,
  type ModelPolicy,
  type ModelStageScope,
} from "@product-woc/development-contracts";

export interface StoredModelPolicy {
  schemaVersion: "1.0.0";
  workspaceId: string;
  projectId: string;
  revision: number;
  policy: ModelPolicy;
  processedRequests: Readonly<Record<string, string>>;
  updatedAt: string;
}

export interface DevelopmentModelPolicyStore {
  load(workspaceId: string, projectId: string): Promise<StoredModelPolicy | undefined>;
  save(value: StoredModelPolicy, expectedRevision: number): Promise<StoredModelPolicy>;
}

export const developmentScopes = modelStageScopeSchema.options.filter(
  (scope): scope is ModelStageScope => scope.startsWith("development."),
);

export function defaultModelPolicy(workspaceId: string, projectId: string, createdAt: string): StoredModelPolicy {
  return {
    schemaVersion: "1.0.0",
    workspaceId,
    projectId,
    revision: 0,
    policy: modelPolicySchema.parse({
      policyId: `local-policy:${projectId}`,
      profiles: [
        {
          profileId: "deterministic-local",
          providerType: "deterministic",
          model: "product-woc-fixture-v1",
          temperature: 0,
          maxOutputTokens: 4096,
          contextWindow: 32768,
          capabilities: { structuredOutput: true, toolCalling: false, vision: false, localOnly: true },
        },
        {
          profileId: "ollama-local",
          providerType: "ollama",
          model: "local-model",
          endpointRef: "ollama-default",
          temperature: 0.2,
          maxOutputTokens: 8192,
          contextWindow: 32768,
          capabilities: { structuredOutput: true, toolCalling: true, vision: false, localOnly: true },
        },
        {
          profileId: "openai-compatible",
          providerType: "openai_compatible",
          model: "configured-model",
          endpointRef: "openai-compatible-default",
          credentialRef: "openai-compatible-key",
          temperature: 0.2,
          maxOutputTokens: 8192,
          contextWindow: 65536,
          capabilities: { structuredOutput: true, toolCalling: true, vision: false, localOnly: false },
        },
      ],
      applicationDefaultProfileId: "deterministic-local",
      projectDefaultProfileId: "deterministic-local",
      stageOverrides: [],
      fallback: "pause",
      createdAt,
    }),
    processedRequests: {},
    updatedAt: createdAt,
  };
}

function parseStoredModelPolicy(value: unknown): StoredModelPolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored Model Policy is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== "1.0.0" ||
    typeof record.workspaceId !== "string" ||
    typeof record.projectId !== "string" ||
    !Number.isInteger(record.revision) ||
    (record.revision as number) < 0 ||
    typeof record.updatedAt !== "string" ||
    typeof record.processedRequests !== "object" ||
    record.processedRequests === null ||
    Array.isArray(record.processedRequests)
  ) {
    throw new Error("Stored Model Policy metadata is invalid");
  }
  const processedRequests = Object.fromEntries(
    Object.entries(record.processedRequests as Record<string, unknown>).map(([key, result]) => {
      if (typeof result !== "string") throw new Error("Stored Model Policy receipt is invalid");
      return [key, result];
    }),
  );
  return {
    schemaVersion: "1.0.0",
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    revision: record.revision as number,
    policy: modelPolicySchema.parse(record.policy),
    processedRequests,
    updatedAt: record.updatedAt,
  };
}

export class InMemoryDevelopmentModelPolicyStore implements DevelopmentModelPolicyStore {
  private readonly values = new Map<string, StoredModelPolicy>();

  public async load(workspaceId: string, projectId: string): Promise<StoredModelPolicy | undefined> {
    return this.values.get(`${workspaceId}:${projectId}`);
  }

  public async save(value: StoredModelPolicy, expectedRevision: number): Promise<StoredModelPolicy> {
    const key = `${value.workspaceId}:${value.projectId}`;
    const current = this.values.get(key);
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error("Model Policy Revision is stale");
    const parsed = parseStoredModelPolicy(value);
    this.values.set(key, parsed);
    return parsed;
  }
}

export class FileDevelopmentModelPolicyStore implements DevelopmentModelPolicyStore {
  public constructor(private readonly directory: string) {}

  private path(workspaceId: string, projectId: string): string {
    const name = createHash("sha256").update(`${workspaceId}:${projectId}`).digest("hex");
    return join(this.directory, `${name}.json`);
  }

  public async load(workspaceId: string, projectId: string): Promise<StoredModelPolicy | undefined> {
    try {
      return parseStoredModelPolicy(JSON.parse(await readFile(this.path(workspaceId, projectId), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  public async save(value: StoredModelPolicy, expectedRevision: number): Promise<StoredModelPolicy> {
    const current = await this.load(value.workspaceId, value.projectId);
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error("Model Policy Revision is stale");
    const parsed = parseStoredModelPolicy(value);
    await mkdir(this.directory, { recursive: true });
    const target = this.path(value.workspaceId, value.projectId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    return parsed;
  }
}
