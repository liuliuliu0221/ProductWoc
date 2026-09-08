import type { AddressInfo } from "node:net";

import { InMemoryDevelopmentCheckpointStore } from "@product-woc/development-adapters";
import {
  initializeDevelopmentCheckpoint,
  parseDurableDevelopmentCheckpoint,
} from "@product-woc/development-workflow";
import {
  loadRuntimeConfiguration,
  type RuntimeConfigurationState,
} from "@product-woc/runtime-config";
import { afterEach, describe, expect, it } from "vitest";

import {
  DevelopmentLabApplication,
  developmentCheckpointKey,
} from "../src/application.js";
import { InMemoryDevelopmentModelPolicyStore } from "../src/model-policy-store.js";
import { createDevelopmentWebServer } from "../src/web-server.js";
import { at, checkpointFixture } from "./fixtures.js";

const servers: ReturnType<typeof createDevelopmentWebServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function setup(runtimeConfiguration?: RuntimeConfigurationState) {
  const checkpoint = checkpointFixture();
  const store = new InMemoryDevelopmentCheckpointStore(parseDurableDevelopmentCheckpoint);
  const initialized = await initializeDevelopmentCheckpoint(store, {
    key: developmentCheckpointKey("local-workspace", "demo-project"),
    requestId: "initialize-web-server",
    aggregate: checkpoint.aggregate,
    workspaceHash: checkpoint.workspaceHash,
    occurredAt: at,
  });
  const application = new DevelopmentLabApplication(
    store,
    { retry: async ({ checkpoint: current }) => current.aggregate },
    new InMemoryDevelopmentModelPolicyStore(),
  );
  const server = createDevelopmentWebServer({ application, runtimeConfiguration });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, initialized };
}

describe("Development Web server", () => {
  it("serves the page, Checkpoint View Model and an SSE connection", async () => {
    const { base } = await setup();
    const page = await fetch(base);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ProductWoc · Development");

    const view = await fetch(`${base}/api/development?projectId=demo-project`);
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({ projectId: "demo-project", status: "running" });

    const abort = new AbortController();
    const stream = await fetch(`${base}/api/events`, { signal: abort.signal });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const first = await stream.body?.getReader().read();
    expect(new TextDecoder().decode(first?.value)).toContain("event: connected");
    abort.abort();
  });

  it("rejects Web model-policy writes and still enforces ordinary write bindings", async () => {
    const { base, initialized } = await setup();
    const response = await fetch(`${base}/api/development/stage-model`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "web-model-once" },
      body: JSON.stringify({
        projectId: "demo-project",
        checkpointRevision: initialized.revision,
        workspaceHash: initialized.value.workspaceHash,
        modelPolicyRevision: 0,
        scope: "development.implementation",
        profileId: "ollama-local",
        impactAcknowledged: true,
      }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });

    const current = await fetch(`${base}/api/development?projectId=demo-project`);
    const currentView = await current.json() as {
      models: { configurationAuthority: string; webEditable: boolean };
    };
    expect(currentView.models).toMatchObject({
      configurationAuthority: "developer_operator",
      webEditable: false,
    });

    const stale = await fetch(`${base}/api/development/pause`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "stale-pause" },
      body: JSON.stringify({
        projectId: "demo-project",
        checkpointRevision: 99,
        workspaceHash: initialized.value.workspaceHash,
        reason: "stale request",
      }),
    });
    expect(stale.status).toBe(409);
  });

  it("serves only sanitized availability and blocks a new run when config is unavailable", async () => {
    const runtime = await loadRuntimeConfiguration({
      configPath: "/tmp/product-woc-web-config-does-not-exist.json",
      environment: {},
    });
    const { base } = await setup(runtime);
    const models = await fetch(`${base}/api/models`);
    const availability = await models.json();
    expect(availability).toMatchObject({
      configurationAuthority: "developer_operator",
      webEditable: false,
      status: "unavailable",
    });
    expect(JSON.stringify(availability)).not.toContain(runtime.sourcePath);

    const start = await fetch(`${base}/api/development/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "blocked-start",
      },
      body: JSON.stringify({ projectId: "demo-project" }),
    });
    expect(start.status).toBe(503);
    expect(await start.json()).toEqual({ error: "服务尚未由开发者完成模型配置" });
  });
});
