import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

import {
  structuredCommandRequestSchema,
  structuredCommandTemplateSchema,
  toolPolicyDecisionSchema,
  workspacePathDecisionSchema,
  workspacePolicySchema,
  type StructuredCommandRequest,
  type StructuredCommandTemplate,
  type ToolPolicyDecision,
  type WorkspacePathDecision,
  type WorkspacePolicy,
} from "@product-woc/development-contracts";

export const defaultWorkspacePolicy = workspacePolicySchema.parse({
  policyVersion: "1.0.0",
  ignoredPathSegments: [
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    ".next",
  ],
  sensitivePathPatterns: [
    ".env*",
    ".ssh/**",
    ".aws/**",
    ".azure/**",
    ".kube/**",
    ".gnupg/**",
    "**/credentials*",
    "**/*secret*",
    "**/*.pem",
    "**/*.key",
  ],
  maxFileSizeBytes: 1_000_000,
  maxFiles: 20_000,
  followSymlinks: false,
});

function decision(
  allowed: boolean,
  reason: WorkspacePathDecision["reason"],
  normalizedRelativePath?: string,
): WorkspacePathDecision {
  return workspacePathDecisionSchema.parse({
    allowed,
    reason,
    ...(normalizedRelativePath ? { normalizedRelativePath } : {}),
  });
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "__GLOBSTAR_DIRECTORY__")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR_DIRECTORY__/g, "(?:.*/)?")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isSensitivePath(
  normalizedPath: string,
  policy: WorkspacePolicy,
): boolean {
  const lower = normalizedPath.toLowerCase();
  const segments = lower.split("/");
  const fileName = segments.at(-1) ?? "";
  if (
    segments.some((segment) =>
      [".ssh", ".aws", ".azure", ".kube", ".gnupg"].includes(segment),
    ) ||
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === "id_rsa" ||
    fileName === "id_ed25519" ||
    fileName === "application_default_credentials.json" ||
    fileName.endsWith(".pem") ||
    fileName.endsWith(".key")
  ) {
    return true;
  }
  return policy.sensitivePathPatterns.some((pattern) =>
    globToRegExp(pattern).test(lower),
  );
}

export function evaluateWorkspacePath(
  inputPath: string,
  policyValue: WorkspacePolicy = defaultWorkspacePolicy,
): WorkspacePathDecision {
  const policy = workspacePolicySchema.parse(policyValue);
  if (
    inputPath.includes("\0") ||
    posix.isAbsolute(inputPath) ||
    win32.isAbsolute(inputPath) ||
    /^[A-Za-z]:/.test(inputPath) ||
    inputPath.startsWith("\\\\")
  ) {
    return decision(false, "absolute_path");
  }
  const portable = inputPath.replaceAll("\\", "/");
  const rawSegments = portable.split("/");
  if (rawSegments.includes("..") || portable.includes(":")) {
    return decision(false, "path_traversal");
  }
  const segments = rawSegments.filter(
    (segment) => segment.length > 0 && segment !== ".",
  );
  const normalized = segments.join("/") || ".";
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const ignored = new Set(
    policy.ignoredPathSegments.map((segment) => segment.toLowerCase()),
  );
  if (lowerSegments.some((segment) => ignored.has(segment))) {
    return decision(false, "ignored_path", normalized);
  }
  if (isSensitivePath(normalized, policy)) {
    return decision(false, "sensitive_path", normalized);
  }
  return decision(true, "allowed", normalized);
}

function hashIdentity(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const permanentlyDeniedKinds = new Set([
  "network",
  "deploy",
  "production_write",
  "credential_access",
]);
const confirmationKinds = new Set([
  "install_dependency",
  "delete",
  "bulk_rewrite",
  "git_commit",
  "git_tag",
  "git_push",
]);
const permanentlyDeniedTokens =
  /\b(deploy|publish|release|production|prod-write|credential|secret|curl|wget|ssh|scp|rsync|dlx)\b/i;

function requiresConfirmationByTokens(
  template: StructuredCommandTemplate,
): boolean {
  const firstArgument = template.args[0]?.toLowerCase();
  return (
    (["pnpm", "npm", "yarn", "bun"].includes(template.executable) &&
      firstArgument !== undefined &&
      ["add", "install", "i"].includes(firstArgument)) ||
    (template.executable === "git" &&
      firstArgument !== undefined &&
      ["commit", "tag", "push"].includes(firstArgument))
  );
}

function isUnsafeTemplate(template: StructuredCommandTemplate): boolean {
  const command = `${template.executable} ${template.args.join(" ")}`;
  if (permanentlyDeniedTokens.test(command)) {
    return true;
  }
  if (
    template.executable === "git" &&
    template.args.some((argument) =>
      ["reset", "clean", "checkout", "restore", "rebase"].includes(
        argument.toLowerCase(),
      ),
    )
  ) {
    return true;
  }
  return false;
}

export class ToolPolicyEngine {
  readonly #policyVersion: string;
  readonly #templates: ReadonlyMap<string, StructuredCommandTemplate>;

  public constructor(
    policyVersion: string,
    templates: readonly StructuredCommandTemplate[],
  ) {
    this.#policyVersion = workspacePolicySchema.shape.policyVersion.parse(
      policyVersion,
    );
    const parsed = templates.map((template) =>
      structuredCommandTemplateSchema.parse(template),
    );
    if (new Set(parsed.map(({ templateId }) => templateId)).size !== parsed.length) {
      throw new Error("Structured command template IDs must be unique");
    }
    this.#templates = new Map(parsed.map((template) => [template.templateId, template]));
  }

  public template(templateId: string): StructuredCommandTemplate | undefined {
    return this.#templates.get(templateId);
  }

  public get policyVersion(): string {
    return this.#policyVersion;
  }

  public assess(
    requestValue: StructuredCommandRequest,
    decidedAt: string,
  ): ToolPolicyDecision {
    const request = structuredCommandRequestSchema.parse(requestValue);
    const template = this.#templates.get(request.templateId);
    let disposition: ToolPolicyDecision["disposition"] = "denied";
    let reason: ToolPolicyDecision["reason"] = "unknown_template";
    if (template) {
      if (permanentlyDeniedKinds.has(template.kind)) {
        reason = "permanently_denied";
      } else if (isUnsafeTemplate(template)) {
        reason = "unsafe_template";
      } else if (
        confirmationKinds.has(template.kind) ||
        requiresConfirmationByTokens(template)
      ) {
        if (
          request.confirmation?.templateId === template.templateId &&
          request.confirmation.actorType === "user"
        ) {
          disposition = "allowed";
          reason = "user_confirmed";
        } else {
          disposition = "requires_confirmation";
          reason = "user_confirmation_required";
        }
      } else {
        disposition = "allowed";
        reason = "approved_template";
      }
    }
    return toolPolicyDecisionSchema.parse({
      decisionId: `tool-decision:${hashIdentity([
        request.requestId,
        request.templateId,
        disposition,
        reason,
      ]).slice(0, 40)}`,
      requestId: request.requestId,
      policyVersion: this.#policyVersion,
      operation: "command",
      disposition,
      reason,
      decidedAt,
    });
  }
}

export function redactToolText(value: string): string {
  return value
    .replace(/\/Users\/[^/\s]+/g, "<home>")
    .replace(/\/home\/[^/\s]+/g, "<home>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "<home>")
    .replace(/(?:sk|pk|api|token|secret|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gi, "[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED EMAIL]");
}
