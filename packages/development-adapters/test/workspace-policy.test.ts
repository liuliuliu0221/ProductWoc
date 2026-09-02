import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ToolPolicyEngine,
  evaluateWorkspacePath,
} from "../src/workspace-policy.js";

const at = "2026-08-29T10:00:00.000Z";

describe("workspace path policy", () => {
  it("passes the checked-in macOS, Linux and Windows path fixture", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/workspace-path-policy-v1.json", import.meta.url),
        "utf8",
      ),
    ) as readonly {
      input: string;
      allowed: boolean;
      reason: string;
      normalizedRelativePath?: string;
    }[];
    for (const sample of fixture) {
      expect(evaluateWorkspacePath(sample.input)).toMatchObject({
        allowed: sample.allowed,
        reason: sample.reason,
        ...(sample.normalizedRelativePath
          ? { normalizedRelativePath: sample.normalizedRelativePath }
          : {}),
      });
    }
  });

  it.each([
    ["/etc/passwd", "absolute_path"],
    ["C:\\Users\\person\\.ssh\\id_rsa", "absolute_path"],
    ["\\\\server\\share\\file.txt", "absolute_path"],
    ["../outside.txt", "path_traversal"],
    ["src/../../outside.txt", "path_traversal"],
    [".ENV", "sensitive_path"],
    ["config/.Env.Local", "sensitive_path"],
    ["home/.SSH/id_rsa", "sensitive_path"],
    ["home/.AWS/credentials", "sensitive_path"],
    ["certs/signing.PEM", "sensitive_path"],
    ["service-secret.json", "sensitive_path"],
    ["src/node_modules/pkg/index.js", "ignored_path"],
  ])("rejects portable high-risk path %s", (path, reason) => {
    expect(evaluateWorkspacePath(path)).toMatchObject({ allowed: false, reason });
  });

  it("normalizes safe Windows separators to a portable relative path", () => {
    expect(evaluateWorkspacePath("src\\domain\\index.ts")).toEqual({
      allowed: true,
      reason: "allowed",
      normalizedRelativePath: "src/domain/index.ts",
    });
  });
});

describe("structured command policy", () => {
  const engine = new ToolPolicyEngine("1.0.0", [
    {
      templateId: "lint",
      kind: "lint",
      executable: "pnpm",
      args: ["lint"],
      timeoutMs: 60_000,
    },
    {
      templateId: "install-zod",
      kind: "install_dependency",
      executable: "pnpm",
      args: ["add", "zod@4.1.5"],
      timeoutMs: 60_000,
    },
    {
      templateId: "deploy",
      kind: "deploy",
      executable: "pnpm",
      args: ["run", "deploy"],
      timeoutMs: 60_000,
    },
    {
      templateId: "disguised-deploy",
      kind: "test",
      executable: "pnpm",
      args: ["run", "deploy"],
      timeoutMs: 60_000,
    },
    {
      templateId: "disguised-install",
      kind: "test",
      executable: "pnpm",
      args: ["add", "zod@4.1.5"],
      timeoutMs: 60_000,
    },
  ]);

  it("allows a registered verification template", () => {
    expect(
      engine.assess(
        { requestId: "run-lint", templateId: "lint", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({ disposition: "allowed", reason: "approved_template" });
  });

  it("requires an exact user confirmation for dependency installation", () => {
    expect(
      engine.assess(
        { requestId: "install-1", templateId: "install-zod", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({
      disposition: "requires_confirmation",
      reason: "user_confirmation_required",
    });
    expect(
      engine.assess(
        {
          requestId: "install-2",
          templateId: "install-zod",
          cwdRelativePath: ".",
          confirmation: {
            confirmationId: "confirm-install",
            actorType: "user",
            actorId: "user-1",
            templateId: "install-zod",
            relativePaths: [],
            confirmedAt: at,
          },
        },
        at,
      ),
    ).toMatchObject({ disposition: "allowed", reason: "user_confirmed" });
  });

  it("permanently rejects deployment including disguised deployment", () => {
    expect(
      engine.assess(
        {
          requestId: "deploy-1",
          templateId: "deploy",
          cwdRelativePath: ".",
          confirmation: {
            confirmationId: "confirm-deploy",
            actorType: "user",
            actorId: "user-1",
            templateId: "deploy",
            relativePaths: [],
            confirmedAt: at,
          },
        },
        at,
      ),
    ).toMatchObject({ disposition: "denied", reason: "permanently_denied" });
    expect(
      engine.assess(
        { requestId: "deploy-2", templateId: "disguised-deploy", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({ disposition: "denied", reason: "unsafe_template" });
  });

  it("requires confirmation for a dependency install even when mislabeled", () => {
    expect(
      engine.assess(
        { requestId: "install-disguised", templateId: "disguised-install", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({
      disposition: "requires_confirmation",
      reason: "user_confirmation_required",
    });
  });

  it("rejects shell control characters before a template can be registered", () => {
    expect(
      () =>
        new ToolPolicyEngine("1.0.0", [
          {
            templateId: "injected",
            kind: "test",
            executable: "pnpm",
            args: ["test;curl", "example.com"],
            timeoutMs: 60_000,
          },
        ]),
    ).toThrow();
  });

  it("rejects destructive Git cleanup even when mislabeled as a test", () => {
    const destructive = new ToolPolicyEngine("1.0.0", [
      {
        templateId: "clean-worktree",
        kind: "test",
        executable: "git",
        args: ["clean", "-fdx"],
        timeoutMs: 60_000,
      },
    ]);
    expect(
      destructive.assess(
        { requestId: "clean-1", templateId: "clean-worktree", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({ disposition: "denied", reason: "unsafe_template" });
  });
});
