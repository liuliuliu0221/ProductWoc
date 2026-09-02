import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  structuredCommandRequestSchema,
  structuredCommandResultSchema,
  toolEventSchema,
  toolPolicyDecisionSchema,
  type StructuredCommandRequest,
  type StructuredCommandResult,
  type StructuredCommandTemplate,
  type ToolPolicyDecision,
  type VerificationErrorCategory,
} from "@product-woc/development-contracts";

import {
  defaultWorkspacePolicy,
  evaluateWorkspacePath,
  redactToolText,
  type ToolPolicyEngine,
} from "./workspace-policy.js";

export interface ProcessExecutionRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  env: Readonly<Record<string, string | undefined>>;
}

export interface ProcessExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errorCategory?: Exclude<
    VerificationErrorCategory,
    "none" | "verification_failed" | "policy_denied"
  >;
}

export interface StructuredProcessExecutor {
  run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult>;
}

export class NodeStructuredProcessExecutor implements StructuredProcessExecutor {
  public run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    return new Promise((resolvePromise) => {
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: { ...request.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const append = (current: string, chunk: Buffer): string =>
        `${current}${chunk.toString("utf8")}`.slice(-2_000_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        const systemError = error as NodeJS.ErrnoException;
        resolvePromise({
          exitCode: 127,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
          errorCategory:
            systemError.code === "ENOENT"
              ? "command_not_found"
              : "infrastructure_failure",
        });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolvePromise({
          exitCode: code ?? 1,
          stdout,
          stderr,
          ...(timedOut ? { errorCategory: "timeout" as const } : {}),
        });
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      }, request.timeoutMs);
    });
  }
}

function hash(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function sanitized(value: string, root: string): string {
  return redactToolText(value).replaceAll(root, "<workspace>");
}

export class StructuredCommandRunner {
  readonly #root: string;
  readonly #policy: ToolPolicyEngine;
  readonly #executor: StructuredProcessExecutor;

  public constructor(
    workspaceRoot: string,
    policy: ToolPolicyEngine,
    executor: StructuredProcessExecutor = new NodeStructuredProcessExecutor(),
  ) {
    this.#root = realpathSync(resolve(workspaceRoot));
    if (!statSync(this.#root).isDirectory()) {
      throw new Error("Workspace root must be a directory");
    }
    this.#policy = policy;
    this.#executor = executor;
  }

  public async run(
    requestValue: StructuredCommandRequest,
    occurredAt: string,
  ): Promise<StructuredCommandResult> {
    const request = structuredCommandRequestSchema.parse(requestValue);
    const cwd = this.#resolveCwd(request.cwdRelativePath);
    if (!cwd) {
      const decision = this.#pathDeniedDecision(request, occurredAt);
      return this.#notExecuted(request, decision, occurredAt);
    }
    const decision = this.#policy.assess(request, occurredAt);
    const template = this.#policy.template(request.templateId);
    if (decision.disposition !== "allowed" || !template) {
      return this.#notExecuted(request, decision, occurredAt, template);
    }
    const execution = await this.#executor.run({
      executable: template.executable,
      args: template.args,
      cwd,
      timeoutMs: template.timeoutMs,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        CI: "1",
        NODE_ENV: "test",
        GIT_TERMINAL_PROMPT: "0",
        npm_config_yes: "false",
      },
    });
    const stdout = sanitized(execution.stdout, this.#root);
    const stderr = sanitized(execution.stderr, this.#root);
    const summarySource = execution.exitCode === 0 ? stdout : stderr || stdout;
    const failureCategory =
      execution.errorCategory ??
      (execution.exitCode === 0 ? "none" : "verification_failed");
    const event = this.#event(
      request,
      decision,
      template,
      `exit=${execution.exitCode}; ${summarySource.slice(0, 1500) || "no output"}`,
      occurredAt,
    );
    return structuredCommandResultSchema.parse({
      executed: true,
      decision,
      event,
      failureCategory,
      exitCode: execution.exitCode,
      stdout,
      stderr,
    });
  }

  #resolveCwd(relativePath: string): string | undefined {
    const pathDecision = evaluateWorkspacePath(relativePath, defaultWorkspacePolicy);
    if (!pathDecision.allowed || !pathDecision.normalizedRelativePath) {
      return undefined;
    }
    const candidate = pathDecision.normalizedRelativePath === "."
      ? this.#root
      : join(this.#root, ...pathDecision.normalizedRelativePath.split("/"));
    if (!existsSync(candidate) || !isWithin(this.#root, candidate)) {
      return undefined;
    }
    let cursor = this.#root;
    for (const segment of pathDecision.normalizedRelativePath === "." ? [] : pathDecision.normalizedRelativePath.split("/")) {
      cursor = join(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) {
        return undefined;
      }
    }
    const canonical = realpathSync(candidate);
    return statSync(canonical).isDirectory() && isWithin(this.#root, canonical)
      ? canonical
      : undefined;
  }

  #pathDeniedDecision(
    request: StructuredCommandRequest,
    occurredAt: string,
  ): ToolPolicyDecision {
    return toolPolicyDecisionSchema.parse({
      decisionId: `tool-decision:${hash([request.requestId, "path_policy_denied"]).slice(0, 40)}`,
      requestId: request.requestId,
      policyVersion: this.#policy.policyVersion,
      operation: "command",
      disposition: "denied",
      reason: "path_policy_denied",
      decidedAt: occurredAt,
    });
  }

  #notExecuted(
    request: StructuredCommandRequest,
    decision: ToolPolicyDecision,
    occurredAt: string,
    template?: StructuredCommandTemplate,
  ): StructuredCommandResult {
    return structuredCommandResultSchema.parse({
      executed: false,
      decision,
      event: this.#event(
        request,
        decision,
        template,
        `command not executed: ${decision.reason}`,
        occurredAt,
      ),
      failureCategory: "policy_denied",
    });
  }

  #event(
    request: StructuredCommandRequest,
    decision: ToolPolicyDecision,
    template: StructuredCommandTemplate | undefined,
    summary: string,
    occurredAt: string,
  ) {
    return toolEventSchema.parse({
      eventId: `tool-event:${hash([decision.decisionId, occurredAt]).slice(0, 40)}`,
      requestId: request.requestId,
      decisionId: decision.decisionId,
      operation: "command",
      disposition: decision.disposition,
      redactedArguments: [
        `template:${request.templateId}`,
        ...(template ? [`kind:${template.kind}`] : []),
        "cwd:<workspace>",
      ],
      resultSummary: sanitized(summary, this.#root),
      occurredAt,
    });
  }
}
