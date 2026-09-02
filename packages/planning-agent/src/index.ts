export type PlanningModelRole =
  | "fast_extract"
  | "planning"
  | "architecture_review";

export interface PlanningModelRequest {
  requestId: string;
  role: PlanningModelRole;
  promptVersion: string;
  schemaVersion: string;
  systemInstructions: string;
  input: Readonly<Record<string, unknown>>;
}

export interface PlanningModelResponse {
  provider: string;
  modelSnapshot: string;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface PlanningModelProvider {
  generate(request: PlanningModelRequest): Promise<PlanningModelResponse>;
}

export interface ModelRoute {
  provider: string;
  model: string;
  timeoutMs: number;
  maxAttempts: number;
}

export interface ModelRouter {
  route(role: PlanningModelRole): ModelRoute;
}

export * from "./project-spec.js";
export * from "./technical-design.js";
export * from "./execution-plan.js";
export * from "./local-provider.js";
export * from "./security.js";
