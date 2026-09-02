import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NodeWorkspaceAdapter } from "@product-woc/development-adapters";
import { modelStageScopeSchema } from "@product-woc/development-contracts";
import { FileTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import type { DurableStandalonePlanningCheckpoint } from "@product-woc/planning-workflow";

import {
  DevelopmentLabApplication,
  DevelopmentLabError,
  type DevelopmentLabActor,
} from "./application.js";
import { createLocalDevelopmentActions } from "./local-actions.js";
import { bootstrapAndStartDevelopmentFromPlanning } from "./bootstrap.js";
import { renderDevelopmentPage } from "./web-page.js";

type JsonObject = Record<string, unknown>;

const localActor: DevelopmentLabActor = {
  workspaceId: "local-workspace",
  actorId: "local-user",
  role: "editor",
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 64_000) throw new DevelopmentLabError("invalid_request", "Request body is too large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DevelopmentLabError("invalid_request", "JSON object expected");
  }
  return value as JsonObject;
}

function requiredString(body: JsonObject, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new DevelopmentLabError("invalid_request", `${name} is required`);
  }
  return value.trim();
}

function requiredRevision(body: JsonObject): number {
  const value = body.checkpointRevision;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new DevelopmentLabError("invalid_request", "checkpointRevision must be positive");
  }
  return value as number;
}

function requiredNonNegativeInteger(body: JsonObject, name: string): number {
  const value = body[name];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new DevelopmentLabError("invalid_request", `${name} must be a non-negative integer`);
  }
  return value as number;
}

function requestKey(request: IncomingMessage): string {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || !value.trim()) {
    throw new DevelopmentLabError("invalid_request", "x-idempotency-key header is required");
  }
  return value.trim();
}

function statusFor(error: unknown): number {
  if (error instanceof DevelopmentLabError) {
    return { forbidden: 403, not_found: 404, conflict: 409, invalid_request: 400, unavailable: 503 }[error.code];
  }
  return 400;
}

export function createDevelopmentWebServer(options?: {
  workspaceRoot?: string;
  dataDirectory?: string;
  planningDataDirectory?: string;
  modelPolicyDataDirectory?: string;
  actor?: DevelopmentLabActor;
  application?: DevelopmentLabApplication;
}) {
  const actor = options?.actor ?? localActor;
  const workspaceRoot = options?.workspaceRoot ?? process.env.PRODUCT_WOC_WORKSPACE_ROOT ?? process.cwd();
  const dataDirectory = options?.dataDirectory ??
    process.env.PRODUCT_WOC_DEVELOPMENT_DATA_DIR ??
    join(workspaceRoot, ".product-woc", "development-checkpoints");
  const planningDirectory = options?.planningDataDirectory ??
    process.env.PRODUCT_WOC_PLANNING_DATA_DIR ??
    join(workspaceRoot, ".product-woc", "checkpoints");
  const modelPolicyDirectory = options?.modelPolicyDataDirectory ??
    process.env.PRODUCT_WOC_MODEL_POLICY_DATA_DIR ??
    join(workspaceRoot, ".product-woc", "model-policies");
  const application = options?.application ?? DevelopmentLabApplication.fileBacked(
    dataDirectory,
    createLocalDevelopmentActions(workspaceRoot),
    modelPolicyDirectory,
  );
  const streams = new Set<ServerResponse>();
  const broadcast = (view: unknown): void => {
    const message = `event: development\ndata: ${JSON.stringify(view)}\n\n`;
    for (const stream of streams) stream.write(message);
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderDevelopmentPage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        response.write("event: connected\ndata: {}\n\n");
        streams.add(response);
        request.on("close", () => streams.delete(response));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/development") {
        const workspaceId = url.searchParams.get("workspaceId") ?? actor.workspaceId;
        const projectId = url.searchParams.get("projectId") ?? "demo-project";
        json(response, 200, await application.get(workspaceId, projectId, actor));
        return;
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/development/")) {
        const action = url.pathname.slice("/api/development/".length);
        const body = await readJson(request);
        const projectId = requiredString(body, "projectId");
        if (action === "start") {
          const started = await bootstrapAndStartDevelopmentFromPlanning({
            workspaceId: actor.workspaceId,
            projectId,
            actorId: actor.actorId,
            workspaceRoot,
            planningDataDirectory: planningDirectory,
            developmentDataDirectory: dataDirectory,
            requestId: requestKey(request),
            occurredAt: new Date().toISOString(),
          });
          const view = await application.get(actor.workspaceId, projectId, actor);
          broadcast(view);
          json(response, started.resumed ? 200 : 201, view);
          return;
        }
        const binding = {
          idempotencyKey: requestKey(request),
          checkpointRevision: requiredRevision(body),
          workspaceHash: requiredString(body, "workspaceHash"),
        };
        const occurredAt = new Date().toISOString();
        let view;
        if (["pause", "cancel"].includes(action)) {
          view = await application.control(
            actor.workspaceId,
            projectId,
            action as "pause" | "cancel",
            requiredString(body, "reason"),
            binding,
            actor,
            occurredAt,
          );
        } else if (action === "resume") {
          const planning = await new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(planningDirectory)
            .load(`${actor.workspaceId}:${projectId}`);
          const envelope = planning?.value.aggregate.developmentStart;
          if (!envelope) throw new DevelopmentLabError("conflict", "Current Planning Envelope is unavailable");
          view = await application.recover(
            actor.workspaceId,
            projectId,
            envelope,
            new NodeWorkspaceAdapter(workspaceRoot).contentManifestHash(),
            binding,
            actor,
            occurredAt,
          );
          if (view.status === "paused" && !view.blockers.length) {
            view = await application.control(
              actor.workspaceId,
              projectId,
              "resume",
              requiredString(body, "reason"),
              {
                idempotencyKey: `${binding.idempotencyKey}:control`,
                checkpointRevision: view.checkpointRevision,
                workspaceHash: view.workspaceHash,
              },
              actor,
              occurredAt,
            );
          }
        } else if (["verify", "rollback", "retry"].includes(action)) {
          view = await application.action(
            actor.workspaceId,
            projectId,
            action as "verify" | "rollback" | "retry",
            binding,
            actor,
            occurredAt,
          );
        } else if (action === "gate") {
          view = await application.gate(
            actor.workspaceId,
            projectId,
            {
              ...binding,
              phaseRunId: requiredString(body, "phaseRunId"),
              userGateId: requiredString(body, "userGateId"),
            },
            actor,
            occurredAt,
          );
        } else if (action === "stage-model") {
          const parsedScope = modelStageScopeSchema.safeParse(requiredString(body, "scope"));
          if (!parsedScope.success || !parsedScope.data.startsWith("development.")) {
            throw new DevelopmentLabError("invalid_request", "A Development model scope is required");
          }
          view = await application.configureStageModel(
            actor.workspaceId,
            projectId,
            {
              ...binding,
              modelPolicyRevision: requiredNonNegativeInteger(body, "modelPolicyRevision"),
              scope: parsedScope.data,
              profileId: requiredString(body, "profileId"),
              impactAcknowledged: body.impactAcknowledged === true,
            },
            actor,
            occurredAt,
          );
        } else {
          json(response, 404, { error: "not_found" });
          return;
        }
        broadcast(view);
        json(response, 200, view);
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch (error) {
      json(response, statusFor(error), {
        error: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PRODUCT_WOC_DEVELOPMENT_WEB_PORT ?? "4273");
  const server = createDevelopmentWebServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`ProductWoc Development Web: http://127.0.0.1:${port}\n`);
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
