import { describe, expect, it } from "vitest";

import {
  ToolPolicyEngine,
  evaluateWorkspacePath,
  redactToolText,
} from "@product-woc/development-adapters";

const at = "2026-09-02T00:00:00.000Z";

describe("Gate G3 high-risk security policy", () => {
  it.each([
    ["../outside.txt", "path_traversal"],
    ["/etc/passwd", "absolute_path"],
    ["C:\\Users\\person\\.ssh\\id_rsa", "absolute_path"],
    [".env.production", "sensitive_path"],
    ["secrets/provider.key", "sensitive_path"],
    ["node_modules/package/index.js", "ignored_path"],
  ])("blocks path %s", (path, reason) => {
    expect(evaluateWorkspacePath(path)).toMatchObject({ allowed: false, reason });
  });

  it("blocks deployment, production writes and disguised publish commands", () => {
    const engine = new ToolPolicyEngine("1.0.0", [
      { templateId: "deploy", kind: "deploy", executable: "pnpm", args: ["run", "deploy"], timeoutMs: 60_000 },
      { templateId: "production", kind: "production_write", executable: "pnpm", args: ["run", "write-production"], timeoutMs: 60_000 },
      { templateId: "publish", kind: "test", executable: "pnpm", args: ["publish"], timeoutMs: 60_000 },
      { templateId: "install", kind: "install_dependency", executable: "pnpm", args: ["add", "example-package@1.0.0"], timeoutMs: 60_000 },
    ]);
    for (const templateId of ["deploy", "production", "publish"]) {
      expect(
        engine.assess(
          { requestId: `request:${templateId}`, templateId, cwdRelativePath: "." },
          at,
        ),
      ).toMatchObject({ disposition: "denied" });
    }
    expect(
      engine.assess(
        { requestId: "request:install", templateId: "install", cwdRelativePath: "." },
        at,
      ),
    ).toMatchObject({
      disposition: "requires_confirmation",
      reason: "user_confirmation_required",
    });
  });

  it("rejects shell control syntax before a command template is registered", () => {
    expect(
      () =>
        new ToolPolicyEngine("1.0.0", [
          { templateId: "injected", kind: "test", executable: "pnpm", args: ["test;curl", "invalid.example"], timeoutMs: 60_000 },
        ]),
    ).toThrow();
  });

  it("redacts credentials, PII and personal paths before persistence", () => {
    const raw = "token=secret-value-12345678 person@example.invalid /Users/person/work";
    const redacted = redactToolText(raw);
    expect(redacted).not.toContain("secret-value-12345678");
    expect(redacted).not.toContain("person@example.invalid");
    expect(redacted).not.toContain("/Users/person");
    expect(redacted).toContain("[REDACTED]");
  });
});
