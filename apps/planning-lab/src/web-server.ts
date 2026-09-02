import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderPlanningPage } from "./web-page.js";
import {
  PlanningWebController,
  PlanningWebError,
  type PlanningWebActor,
} from "./web-controller.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDataDirectory = process.env.PRODUCT_WOC_PLANNING_DATA_DIR ??
  process.env.PRODUCT_WOC_DATA_DIR ??
  join(process.cwd(), ".product-woc/checkpoints");
const socialPreviewPath = join(moduleDirectory, "../assets/productwoc-social-preview.png");

const localActor: PlanningWebActor = {
  workspaceId: "local-workspace",
  actorId: "local-user",
  role: "editor",
};
type JsonObject = Record<string, unknown>;

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
    size += buffer.length;
    if (size > 32_768) {
      throw new PlanningWebError("invalid_request", "Request body is too large");
    }
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PlanningWebError("invalid_request", "JSON object expected");
  }
  return parsed as JsonObject;
}

function requiredString(body: JsonObject, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlanningWebError("invalid_request", `${field} is required`);
  }
  return value.trim();
}

function idempotencyKey(request: IncomingMessage): string {
  const value = request.headers["x-idempotency-key"];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlanningWebError("invalid_request", "x-idempotency-key header is required");
  }
  return value.trim();
}

function statusFor(error: unknown): number {
  if (error instanceof PlanningWebError) {
    return { forbidden: 403, not_found: 404, conflict: 409, invalid_request: 400 }[
      error.code
    ];
  }
  return 400;
}

export function createPlanningWebServer(options?: {
  dataDirectory?: string;
  actor?: PlanningWebActor;
}) {
  const actor = options?.actor ?? localActor;
  const controller = PlanningWebController.fileBacked(
    options?.dataDirectory ?? defaultDataDirectory,
  );
  const streams = new Set<ServerResponse>();
  const broadcast = (view: unknown): void => {
    const message = `event: planning\ndata: ${JSON.stringify(view)}\n\n`;
    for (const stream of streams) stream.write(message);
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderPlanningPage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/og.png") {
        response.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "public, max-age=3600",
        });
        response.end(await readFile(socialPreviewPath));
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
      if (request.method === "GET" && url.pathname === "/api/session") {
        const workspaceId = url.searchParams.get("workspaceId") ?? actor.workspaceId;
        const projectId = url.searchParams.get("projectId") ?? "demo-project";
        json(response, 200, await controller.get(workspaceId, projectId, actor));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session/start") {
        const body = await readJson(request);
        const view = await controller.start(
          {
            workspaceId: actor.workspaceId,
            projectId: requiredString(body, "projectId"),
            requestedBy: actor.actorId,
            requestId: idempotencyKey(request),
            idea: requiredString(body, "idea"),
          },
          actor,
        );
        broadcast(view);
        json(response, 200, view);
        return;
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/session/")) {
        const body = await readJson(request);
        const key = idempotencyKey(request);
        const projectId = requiredString(body, "projectId");
        const versionId = requiredString(body, "versionId");
        const hash = requiredString(body, "hash");
        let view;
        if (url.pathname === "/api/session/approve") {
          view = await controller.approve(
            actor.workspaceId,
            projectId,
            {
              idempotencyKey: key,
              subject: requiredString(body, "subject") as "project_spec" | "technical_design" | "execution_plan",
              versionId,
              hash,
            },
            actor,
          );
        } else if (url.pathname === "/api/session/revise") {
          view = await controller.revise(
            actor.workspaceId,
            projectId,
            {
              idempotencyKey: key,
              subject: requiredString(body, "subject") as "project_spec" | "technical_design" | "execution_plan",
              versionId,
              hash,
              feedback: requiredString(body, "feedback"),
            },
            actor,
          );
        } else if (url.pathname === "/api/session/cancel") {
          view = await controller.cancel(
            actor.workspaceId,
            projectId,
            {
              idempotencyKey: key,
              versionId,
              hash,
              reason: requiredString(body, "reason"),
            },
            actor,
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
      const message = error instanceof Error ? error.message : "Unexpected error";
      json(response, statusFor(error), { error: message });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PRODUCT_WOC_WEB_PORT ?? "4173");
  const host = "127.0.0.1";
  const server = createPlanningWebServer();
  server.listen(port, host, () => {
    process.stdout.write(`ProductWoc Web: http://${host}:${port}\n`);
  });
  const stop = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
