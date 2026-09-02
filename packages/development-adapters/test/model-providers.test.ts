import { describe, expect, it } from "vitest";

import type {
  ModelProfile,
  ModelProviderPort,
  ModelProviderRequest,
} from "@product-woc/development-contracts";

import {
  DeterministicModelProvider,
  OllamaCompatibleModelProvider,
  OpenAICompatibleModelProvider,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
  type ModelRuntimeReferenceResolver,
} from "../src/model-providers.js";

class StubReferences implements ModelRuntimeReferenceResolver {
  public constructor(
    private readonly endpoint: string,
    private readonly credential?: string,
  ) {}

  public async resolveEndpoint(): Promise<string> {
    return this.endpoint;
  }

  public async resolveCredential(): Promise<string | undefined> {
    return this.credential;
  }
}

class ThrowingReferences implements ModelRuntimeReferenceResolver {
  public async resolveEndpoint(): Promise<never> {
    throw new Error("resolver exposed an unsafe internal value");
  }

  public async resolveCredential(): Promise<never> {
    throw new Error("resolver exposed an unsafe internal value");
  }
}

class QueueTransport implements HttpTransport {
  public readonly requests: HttpTransportRequest[] = [];

  public constructor(
    private readonly responses: readonly (HttpTransportResponse | Error)[],
  ) {}

  public async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    this.requests.push(request);
    const response = this.responses[this.requests.length - 1];
    if (!response) {
      throw new Error("No stub response configured");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

const request: ModelProviderRequest = {
  requestId: "provider-request-1",
  scope: "development.implementation",
  systemInstructions: "Return JSON.",
  input: { taskId: "task-1" },
  responseFormat: "json",
  contextTokens: 100,
};

function profile(
  providerType: ModelProfile["providerType"],
  overrides: Partial<ModelProfile> = {},
): ModelProfile {
  return {
    profileId: `${providerType}-profile`,
    providerType,
    model: `${providerType}-model`,
    ...(providerType === "deterministic"
      ? {}
      : { endpointRef: `${providerType}-endpoint` }),
    temperature: 0,
    maxOutputTokens: 4096,
    contextWindow: 8192,
    capabilities: {
      structuredOutput: true,
      toolCalling: false,
      vision: false,
      localOnly: providerType !== "openai_compatible",
    },
    ...overrides,
  };
}

async function expectProviderContract(
  provider: ModelProviderPort,
  modelProfile: ModelProfile,
): Promise<void> {
  await expect(provider.testConnection(modelProfile)).resolves.toMatchObject({
    connected: true,
  });
  await expect(provider.generate(modelProfile, request)).resolves.toMatchObject({
    success: true,
    response: {
      output: expect.anything(),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      latencyMs: expect.any(Number),
    },
  });
}

describe("model provider contract", () => {
  it("runs the Deterministic Provider fully offline", async () => {
    await expectProviderContract(
      new DeterministicModelProvider(),
      profile("deterministic"),
    );
  });

  it("runs the Ollama-compatible Provider through an injected transport", async () => {
    const transport = new QueueTransport([
      { status: 200, body: { models: [] } },
      {
        status: 200,
        body: {
          created_at: "fixture-1",
          message: { content: "{\"ok\":true}" },
          prompt_eval_count: 12,
          eval_count: 4,
        },
      },
    ]);
    const provider = new OllamaCompatibleModelProvider(
      transport,
      new StubReferences("http://127.0.0.1:11434"),
    );

    await expectProviderContract(provider, profile("ollama"));
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/chat",
    ]);
  });

  it("runs the OpenAI-compatible Provider without a vendor SDK", async () => {
    const transport = new QueueTransport([
      { status: 200, body: { data: [] } },
      {
        status: 200,
        body: {
          id: "compatible-response-1",
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 10, completion_tokens: 3 },
        },
      },
    ]);
    const provider = new OpenAICompatibleModelProvider(
      transport,
      new StubReferences("https://compatible.invalid/v1", "credential-test-value"),
    );

    await expectProviderContract(
      provider,
      profile("openai_compatible", {
        credentialRef: "credential-ref-1",
      }),
    );
    expect(transport.requests.map(({ url }) => url)).toEqual([
      "https://compatible.invalid/v1/models",
      "https://compatible.invalid/v1/chat/completions",
    ]);
    expect(transport.requests[1]?.headers.authorization).toBe(
      "Bearer credential-test-value",
    );
  });
});

describe("provider failure safety", () => {
  it("converts reference resolver exceptions into a safe configuration failure", async () => {
    const provider = new OpenAICompatibleModelProvider(
      new QueueTransport([]),
      new ThrowingReferences(),
    );

    await expect(
      provider.generate(profile("openai_compatible"), request),
    ).resolves.toEqual({
      success: false,
      code: "configuration_error",
      message: "The Endpoint Ref resolver failed",
      recoverable: true,
    });
  });

  it("redacts endpoint and credential values from recoverable errors", async () => {
    const endpoint = "https://private-endpoint.invalid/v1";
    const credential = "credential-test-value";
    const transport = new QueueTransport([
      new Error(`Cannot reach ${endpoint} with Bearer ${credential}`),
    ]);
    const provider = new OpenAICompatibleModelProvider(
      transport,
      new StubReferences(endpoint, credential),
    );
    const result = await provider.generate(
      profile("openai_compatible", { credentialRef: "credential-ref-1" }),
      request,
    );

    expect(result).toMatchObject({
      success: false,
      code: "unavailable",
      recoverable: true,
    });
    expect(JSON.stringify(result)).not.toContain(endpoint);
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  it("reports authentication failures without exposing response bodies", async () => {
    const provider = new OpenAICompatibleModelProvider(
      new QueueTransport([
        { status: 401, body: { error: "credential-test-value" } },
      ]),
      new StubReferences("https://compatible.invalid", "credential-test-value"),
    );
    const result = await provider.generate(
      profile("openai_compatible", { credentialRef: "credential-ref-1" }),
      request,
    );

    expect(result).toEqual({
      success: false,
      code: "authentication_failed",
      message: "The OpenAI-compatible endpoint rejected the model request",
      recoverable: false,
    });
  });
});
