import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverRuntimeConfigPath,
  loadRuntimeConfiguration,
  resolveRuntimeProfileEnvironment,
} from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function fixture(): Promise<{ directory: string; path: string; value: unknown }> {
  const directory = await mkdtemp(join(tmpdir(), "product-woc-runtime-config-"));
  directories.push(directory);
  const value = JSON.parse(await readFile(
    new URL("../../../fixtures/runtime-config-valid-v1.json", import.meta.url),
    "utf8",
  )) as unknown;
  const path = join(directory, "productwoc.config.json");
  return { directory, path, value };
}

const environment = {
  PRODUCT_WOC_OLLAMA_ENDPOINT: "http://127.0.0.1:11434",
  PRODUCT_WOC_PLANNING_ENDPOINT: "https://planning.invalid/v1",
  PRODUCT_WOC_PLANNING_CREDENTIAL: "planning-secret",
  PRODUCT_WOC_CODE_ENDPOINT: "https://code.invalid/v1",
  PRODUCT_WOC_CODE_CREDENTIAL: "code-secret",
};

describe("runtime configuration loader", () => {
  it("discovers the explicit, environment and default paths in order", () => {
    expect(discoverRuntimeConfigPath({
      cwd: "/workspace",
      configPath: "explicit.json",
      environment: { PRODUCT_WOC_CONFIG_PATH: "environment.json" },
    })).toBe("/workspace/explicit.json");
    expect(discoverRuntimeConfigPath({
      cwd: "/workspace",
      environment: { PRODUCT_WOC_CONFIG_PATH: "environment.json" },
    })).toBe("/workspace/environment.json");
    expect(discoverRuntimeConfigPath({ cwd: "/workspace", environment: {} }))
      .toBe("/workspace/productwoc.config.json");
  });

  it("loads one immutable operator snapshot and exposes only a sanitized Web view", async () => {
    const subject = await fixture();
    await writeFile(subject.path, JSON.stringify(subject.value, null, 2));
    const loaded = await loadRuntimeConfiguration({
      cwd: subject.directory,
      environment,
      loadedAt: "2026-09-08T00:00:00.000Z",
    });
    expect(loaded).toMatchObject({
      valid: true,
      readyForGeneration: true,
      availability: { status: "configured", webEditable: false },
    });
    expect(loaded.availability.stages).toHaveLength(7);
    expect(loaded.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(loaded.config)).toBe(true);
    expect(Object.isFrozen(loaded.config?.profiles)).toBe(true);
    expect(Object.isFrozen(loaded.operatorSnapshot)).toBe(true);
    expect(JSON.stringify(loaded.availability)).not.toContain("Ref");
    expect(JSON.stringify(loaded)).not.toContain("planning-secret");
  });

  it("reports missing references without exposing values and closes generation", async () => {
    const subject = await fixture();
    await writeFile(subject.path, JSON.stringify(subject.value));
    const loaded = await loadRuntimeConfiguration({ cwd: subject.directory, environment: {} });
    expect(loaded.valid).toBe(false);
    expect(loaded.readyForGeneration).toBe(false);
    expect(loaded.availability.status).toBe("unavailable");
    expect(loaded.diagnostics.some(({ code }) => code === "environment_value_missing"))
      .toBe(true);
  });

  it("fails closed for missing, invalid and inline-credential configurations", async () => {
    const subject = await fixture();
    const missing = await loadRuntimeConfiguration({ cwd: subject.directory, environment: {} });
    expect(missing.diagnostics[0]?.code).toBe("config_missing");

    await writeFile(subject.path, "{broken");
    const invalidJson = await loadRuntimeConfiguration({ cwd: subject.directory, environment: {} });
    expect(invalidJson.diagnostics[0]?.code).toBe("invalid_json");

    const invalidCredential = await readFile(
      new URL("../../../fixtures/runtime-config-invalid-credential-v1.json", import.meta.url),
      "utf8",
    );
    await writeFile(subject.path, invalidCredential);
    const inline = await loadRuntimeConfiguration({ cwd: subject.directory, environment });
    expect(inline.diagnostics.some(({ code }) => code === "schema_invalid")).toBe(true);
    expect(JSON.stringify(inline)).not.toContain("must-not-be-stored-here");
  });

  it("resolves secret values only through the explicit adapter-boundary function", async () => {
    const subject = await fixture();
    await writeFile(subject.path, JSON.stringify(subject.value));
    const loaded = await loadRuntimeConfiguration({ cwd: subject.directory, environment });
    const profile = loaded.config?.profiles.find(({ profileId }) => profileId === "product-planner");
    if (!profile) throw new Error("Expected product-planner profile");
    expect(resolveRuntimeProfileEnvironment(profile, environment)).toEqual({
      endpoint: "https://planning.invalid/v1",
      credential: "planning-secret",
    });
  });
});
