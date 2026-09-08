import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuntimeConfiguration } from "@product-woc/runtime-config";
import { afterEach, describe, expect, it } from "vitest";

import { createPlanningWebServer } from "../src/web-server.js";

const servers: ReturnType<typeof createPlanningWebServer>[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

async function listen(
  runtimeConfiguration?: Awaited<ReturnType<typeof loadRuntimeConfiguration>>,
): Promise<string> {
  const dataDirectory = await mkdtemp(join(tmpdir(), "product-woc-planning-web-"));
  directories.push(dataDirectory);
  const server = createPlanningWebServer({
    dataDirectory,
    ...(runtimeConfiguration ? { runtimeConfiguration } : {}),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Planning Web server model boundary", () => {
  it("serves seven sanitized test-stage statuses", async () => {
    const base = await listen();
    const response = await fetch(`${base}/api/models`);
    const view = await response.json() as {
      webEditable: boolean;
      status: string;
      stages: unknown[];
    };
    expect(response.status).toBe(200);
    expect(view).toMatchObject({ webEditable: false, status: "test_mode" });
    expect(view.stages).toHaveLength(7);
    expect(JSON.stringify(view)).not.toContain("Ref");
  });

  it("returns a generic 503 for new generation when configuration is unavailable", async () => {
    const runtime = await loadRuntimeConfiguration({
      configPath: "/tmp/product-woc-planning-web-config-does-not-exist.json",
      environment: {},
    });
    const base = await listen(runtime);
    const response = await fetch(`${base}/api/session/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-idempotency-key": "unavailable-start",
      },
      body: JSON.stringify({
        projectId: "unavailable-project",
        idea: "Build a private planning tool",
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "服务尚未由开发者完成模型配置" });
  });
});
