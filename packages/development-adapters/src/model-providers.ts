import type {
  ModelConnectionResult,
  ModelProfile,
  ModelProviderFailureCode,
  ModelProviderPort,
  ModelProviderRequest,
  ModelProviderResult,
} from "@product-woc/development-contracts";

export interface HttpTransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
  timeoutMs: number;
}

export interface HttpTransportResponse {
  status: number;
  body: unknown;
}

export interface HttpTransport {
  send(request: HttpTransportRequest): Promise<HttpTransportResponse>;
}

export interface ModelRuntimeReferenceResolver {
  resolveEndpoint(endpointRef: string): Promise<string | undefined>;
  resolveCredential(credentialRef: string): Promise<string | undefined>;
}

export class FetchHttpTransport implements HttpTransport {
  public async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = text;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface ResolvedRuntime {
  endpoint: string;
  credential?: string;
}

type RuntimeResolution =
  | { success: true; runtime: ResolvedRuntime }
  | {
      success: false;
      failure: Extract<ModelProviderResult, { success: false }>;
    };

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function responseFailure(
  status: number,
  message: string,
): Extract<ModelProviderResult, { success: false }> {
  const code: ModelProviderFailureCode =
    status === 401 || status === 403
      ? "authentication_failed"
      : status === 408 || status === 504
        ? "timeout"
        : status >= 500
          ? "unavailable"
          : "invalid_response";
  return {
    success: false,
    code,
    message,
    recoverable: code !== "authentication_failed",
  };
}

function redactError(error: unknown, sensitiveValues: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of sensitiveValues) {
    if (value.length > 0) {
      message = message.split(value).join("[REDACTED]");
    }
  }
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]")
    .slice(0, 500);
}

function caughtFailure(
  error: unknown,
  sensitiveValues: readonly string[],
): Extract<ModelProviderResult, { success: false }> {
  const timedOut = error instanceof Error && error.name === "AbortError";
  return {
    success: false,
    code: timedOut ? "timeout" : "unavailable",
    message: redactError(error, sensitiveValues),
    recoverable: true,
  };
}

function connectionFromFailure(
  failure: Extract<ModelProviderResult, { success: false }>,
): ModelConnectionResult {
  return {
    connected: false,
    code: failure.code,
    message: failure.message,
    recoverable: failure.recoverable,
  };
}

abstract class CompatibleHttpModelProvider implements ModelProviderPort {
  public abstract readonly providerType: ModelProfile["providerType"];

  public constructor(
    protected readonly transport: HttpTransport,
    protected readonly references: ModelRuntimeReferenceResolver,
    protected readonly timeoutMs = 30_000,
  ) {}

  protected abstract connectionPath(endpoint: string): string;

  protected async resolveRuntime(profile: ModelProfile): Promise<RuntimeResolution> {
    if (!profile.endpointRef) {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Model Profile has no Endpoint Ref",
          recoverable: true,
        },
      };
    }
    let endpoint: string | undefined;
    try {
      endpoint = await this.references.resolveEndpoint(profile.endpointRef);
    } catch {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Endpoint Ref resolver failed",
          recoverable: true,
        },
      };
    }
    if (!endpoint) {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Endpoint Ref could not be resolved",
          recoverable: true,
        },
      };
    }
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Endpoint Ref resolved to an invalid HTTP endpoint",
          recoverable: true,
        },
      };
    }
    let credential: string | undefined;
    try {
      credential = profile.credentialRef
        ? await this.references.resolveCredential(profile.credentialRef)
        : undefined;
    } catch {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Credential Ref resolver failed",
          recoverable: true,
        },
      };
    }
    if (profile.credentialRef && !credential) {
      return {
        success: false,
        failure: {
          success: false,
          code: "configuration_error",
          message: "The Credential Ref could not be resolved",
          recoverable: true,
        },
      };
    }
    return {
      success: true,
      runtime: {
        endpoint,
        ...(credential ? { credential } : {}),
      },
    };
  }

  protected headers(runtime: ResolvedRuntime): Readonly<Record<string, string>> {
    return {
      "content-type": "application/json",
      ...(runtime.credential
        ? { authorization: `Bearer ${runtime.credential}` }
        : {}),
    };
  }

  public async testConnection(profile: ModelProfile): Promise<ModelConnectionResult> {
    const resolved = await this.resolveRuntime(profile);
    if (!resolved.success) {
      return connectionFromFailure(resolved.failure);
    }
    const startedAt = Date.now();
    try {
      const response = await this.transport.send({
        method: "GET",
        url: this.connectionPath(resolved.runtime.endpoint),
        headers: this.headers(resolved.runtime),
        timeoutMs: this.timeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return connectionFromFailure(
          responseFailure(response.status, "The model endpoint rejected the connection test"),
        );
      }
      return { connected: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return connectionFromFailure(
        caughtFailure(error, [
          resolved.runtime.endpoint,
          resolved.runtime.credential ?? "",
        ]),
      );
    }
  }

  public abstract generate(
    profile: ModelProfile,
    request: ModelProviderRequest,
  ): Promise<ModelProviderResult>;
}

export class DeterministicModelProvider implements ModelProviderPort {
  public readonly providerType = "deterministic" as const;

  public async testConnection(_profile: ModelProfile): Promise<ModelConnectionResult> {
    return { connected: true, latencyMs: 0 };
  }

  public async generate(
    profile: ModelProfile,
    request: ModelProviderRequest,
  ): Promise<ModelProviderResult> {
    const output = {
      fixture: "product-woc-development-deterministic-v1",
      model: profile.model,
      scope: request.scope,
      input: request.input,
    };
    return {
      success: true,
      response: {
        providerRequestId: `deterministic-${request.requestId}`,
        output,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    };
  }
}

export class OllamaCompatibleModelProvider extends CompatibleHttpModelProvider {
  public readonly providerType = "ollama" as const;

  protected connectionPath(endpoint: string): string {
    return joinUrl(endpoint, "api/tags");
  }

  public async generate(
    profile: ModelProfile,
    request: ModelProviderRequest,
  ): Promise<ModelProviderResult> {
    const resolved = await this.resolveRuntime(profile);
    if (!resolved.success) {
      return resolved.failure;
    }
    const startedAt = Date.now();
    try {
      const response = await this.transport.send({
        method: "POST",
        url: joinUrl(resolved.runtime.endpoint, "api/chat"),
        headers: this.headers(resolved.runtime),
        body: {
          model: profile.model,
          stream: false,
          messages: [
            { role: "system", content: request.systemInstructions },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          ...(request.responseFormat === "json" ? { format: "json" } : {}),
          ...(request.tools ? { tools: request.tools } : {}),
          options: {
            temperature: profile.temperature,
            num_predict: profile.maxOutputTokens,
          },
        },
        timeoutMs: this.timeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return responseFailure(
          response.status,
          "The Ollama-compatible endpoint rejected the model request",
        );
      }
      const body = objectValue(response.body);
      const message = objectValue(body?.message);
      const content = message?.content;
      if (typeof content !== "string") {
        return responseFailure(422, "The Ollama-compatible response was invalid");
      }
      let output: unknown = content;
      if (request.responseFormat === "json") {
        try {
          output = JSON.parse(content);
        } catch {
          return responseFailure(422, "The model did not return valid JSON");
        }
      }
      return {
        success: true,
        response: {
          providerRequestId:
            typeof body?.created_at === "string"
              ? `ollama-${body.created_at}`
              : `ollama-${request.requestId}`,
          output,
          inputTokens: numberValue(body?.prompt_eval_count),
          outputTokens: numberValue(body?.eval_count),
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      return caughtFailure(error, [
        resolved.runtime.endpoint,
        resolved.runtime.credential ?? "",
      ]);
    }
  }
}

export class OpenAICompatibleModelProvider extends CompatibleHttpModelProvider {
  public readonly providerType = "openai_compatible" as const;

  protected connectionPath(endpoint: string): string {
    return joinUrl(endpoint, endpoint.replace(/\/+$/, "").endsWith("/v1") ? "models" : "v1/models");
  }

  public async generate(
    profile: ModelProfile,
    request: ModelProviderRequest,
  ): Promise<ModelProviderResult> {
    const resolved = await this.resolveRuntime(profile);
    if (!resolved.success) {
      return resolved.failure;
    }
    const startedAt = Date.now();
    try {
      const response = await this.transport.send({
        method: "POST",
        url: joinUrl(
          resolved.runtime.endpoint,
          resolved.runtime.endpoint.replace(/\/+$/, "").endsWith("/v1")
            ? "chat/completions"
            : "v1/chat/completions",
        ),
        headers: this.headers(resolved.runtime),
        body: {
          model: profile.model,
          messages: [
            { role: "system", content: request.systemInstructions },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          temperature: profile.temperature,
          max_tokens: profile.maxOutputTokens,
          ...(request.responseFormat === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
          ...(request.tools ? { tools: request.tools } : {}),
        },
        timeoutMs: this.timeoutMs,
      });
      if (response.status < 200 || response.status >= 300) {
        return responseFailure(
          response.status,
          "The OpenAI-compatible endpoint rejected the model request",
        );
      }
      const body = objectValue(response.body);
      const choices = Array.isArray(body?.choices) ? body.choices : [];
      const choice = objectValue(choices[0]);
      const message = objectValue(choice?.message);
      const content = message?.content;
      if (typeof content !== "string") {
        return responseFailure(422, "The OpenAI-compatible response was invalid");
      }
      let output: unknown = content;
      if (request.responseFormat === "json") {
        try {
          output = JSON.parse(content);
        } catch {
          return responseFailure(422, "The model did not return valid JSON");
        }
      }
      const usage = objectValue(body?.usage);
      return {
        success: true,
        response: {
          providerRequestId:
            typeof body?.id === "string"
              ? body.id
              : `openai-compatible-${request.requestId}`,
          output,
          inputTokens: numberValue(usage?.prompt_tokens),
          outputTokens: numberValue(usage?.completion_tokens),
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      return caughtFailure(error, [
        resolved.runtime.endpoint,
        resolved.runtime.credential ?? "",
      ]);
    }
  }
}
