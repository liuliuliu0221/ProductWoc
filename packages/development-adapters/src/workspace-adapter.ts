import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  toolEventSchema,
  workspaceBaselineSchema,
  workspaceGitBaselineSchema,
  workspaceListRequestSchema,
  workspacePatchRequestSchema,
  workspaceReadRequestSchema,
  workspaceSearchRequestSchema,
  workspacePolicySchema,
  type ToolEvent,
  type WorkspaceBaseline,
  type WorkspaceGitBaseline,
  type WorkspaceListRequest,
  type WorkspacePatchRequest,
  type WorkspacePathDecision,
  type WorkspacePolicy,
  type WorkspaceReadRequest,
  type WorkspaceSearchRequest,
} from "@product-woc/development-contracts";

import {
  defaultWorkspacePolicy,
  evaluateWorkspacePath,
  redactToolText,
} from "./workspace-policy.js";

export interface GitWorkspaceInspector {
  inspect(canonicalRoot: string): WorkspaceGitBaseline;
}

export interface WorkspaceListEntry {
  relativePath: string;
  kind: "file" | "directory";
  sizeBytes?: number;
}

export interface WorkspaceSearchMatch {
  relativePath: string;
  line: number;
  preview: string;
}

export interface WorkspaceToolExecution<T> {
  decision: WorkspacePathDecision;
  event: ToolEvent;
  value?: T;
}

export interface WorkspacePatchOutcome {
  relativePath: string;
  beforeHash?: string;
  afterHash?: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

function gitOutput(
  root: string,
  args: readonly string[],
  trim = true,
): string | undefined {
  const result = spawnSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
    maxBuffer: 2_000_000,
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.status === 0
    ? trim
      ? result.stdout.trim()
      : result.stdout
    : undefined;
}

export class LocalGitWorkspaceInspector implements GitWorkspaceInspector {
  public inspect(canonicalRoot: string): WorkspaceGitBaseline {
    const inside = gitOutput(canonicalRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") {
      return { isRepository: false, dirtyPaths: [] };
    }
    const commit = gitOutput(canonicalRoot, ["rev-parse", "HEAD"]);
    const branch = gitOutput(canonicalRoot, ["branch", "--show-current"]);
    const status = gitOutput(
      canonicalRoot,
      ["status", "--porcelain=v1", "-z"],
      false,
    );
    const dirtyPaths = (status ?? "")
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3).replaceAll("\\", "/"))
      .filter((path) => evaluateWorkspacePath(path).allowed);
    return {
      isRepository: true,
      ...(commit ? { commit } : {}),
      ...(branch ? { branch } : {}),
      dirtyPaths,
    };
  }
}

interface ResolvedWorkspacePath {
  decision: WorkspacePathDecision;
  absolutePath?: string;
  normalizedRelativePath?: string;
}

export class NodeWorkspaceAdapter {
  readonly #root: string;
  readonly #policy: WorkspacePolicy;
  readonly #gitInspector: GitWorkspaceInspector;
  readonly #events: ToolEvent[] = [];

  public constructor(
    workspaceRoot: string,
    policy: WorkspacePolicy = defaultWorkspacePolicy,
    gitInspector: GitWorkspaceInspector = new LocalGitWorkspaceInspector(),
  ) {
    const canonical = realpathSync(resolve(workspaceRoot));
    if (!statSync(canonical).isDirectory()) {
      throw new Error("Workspace root must be a directory");
    }
    this.#root = canonical;
    this.#policy = workspacePolicySchema.parse(policy);
    this.#gitInspector = gitInspector;
  }

  public get events(): readonly ToolEvent[] {
    return [...this.#events];
  }

  public contentManifestHash(): string {
    return sha256(
      JSON.stringify(
        this.#walkFiles(".").map(({ relativePath, sizeBytes, hash }) => ({
          relativePath,
          sizeBytes,
          contentHash: hash,
        })),
      ),
    );
  }

  public createBaseline(baselineId: string, createdAt: string): WorkspaceBaseline {
    const inspectedGit = workspaceGitBaselineSchema.parse(
      this.#gitInspector.inspect(this.#root),
    );
    const git = workspaceGitBaselineSchema.parse({
      ...inspectedGit,
      dirtyPaths: inspectedGit.dirtyPaths.flatMap((path) => {
        const pathDecision = evaluateWorkspacePath(path, this.#policy);
        return pathDecision.allowed && pathDecision.normalizedRelativePath
          ? [pathDecision.normalizedRelativePath]
          : [];
      }),
    });
    const dirty = new Set(git.dirtyPaths.map((path) => path.toLowerCase()));
    const files = this.#walkFiles(".").map(({ relativePath, sizeBytes, hash }) => ({
      relativePath,
      sizeBytes,
      contentHash: hash,
      userModified: dirty.has(relativePath.toLowerCase()),
    }));
    if (files.length > this.#policy.maxFiles) {
      throw new Error("Workspace file limit exceeded");
    }
    const instructions = files
      .filter(({ relativePath }) => basename(relativePath).toLowerCase() === "agents.md")
      .map(({ relativePath, sizeBytes, contentHash }) => ({
        relativePath,
        sizeBytes,
        contentHash,
      }));
    const content = {
      baselineId,
      workspaceRoot: this.#root,
      workspaceRootHash: sha256(this.#root),
      policyVersion: this.#policy.policyVersion,
      files,
      instructions,
      git,
      ignoredPathSegments: this.#policy.ignoredPathSegments,
      sensitivePathPatterns: this.#policy.sensitivePathPatterns,
      createdAt,
    };
    return workspaceBaselineSchema.parse({
      ...content,
      baselineHash: sha256(JSON.stringify(content)),
    });
  }

  public list(requestValue: WorkspaceListRequest, occurredAt: string): WorkspaceToolExecution<readonly WorkspaceListEntry[]> {
    const request = workspaceListRequestSchema.parse(requestValue);
    const resolved = this.#resolve(request.relativePath, "read", false);
    if (!resolved.decision.allowed || !resolved.absolutePath) {
      return this.#execution(request.requestId, "list", resolved.decision, occurredAt);
    }
    if (!statSync(resolved.absolutePath).isDirectory()) {
      return this.#execution(
        request.requestId,
        "list",
        { ...resolved.decision, allowed: false, reason: "not_file" },
        occurredAt,
      );
    }
    const entries = readdirSync(resolved.absolutePath, { withFileTypes: true })
      .flatMap((entry) => {
        const parent = resolved.normalizedRelativePath === "." ? "" : `${resolved.normalizedRelativePath}/`;
        const childPath = `${parent}${entry.name}`;
        const childDecision = evaluateWorkspacePath(childPath, this.#policy);
        if (!childDecision.allowed || entry.isSymbolicLink()) {
          return [];
        }
        const absolutePath = join(resolved.absolutePath as string, entry.name);
        return [{
          relativePath: childDecision.normalizedRelativePath as string,
          kind: entry.isDirectory() ? "directory" as const : "file" as const,
          ...(entry.isFile() ? { sizeBytes: statSync(absolutePath).size } : {}),
        }];
      })
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return this.#execution(request.requestId, "list", resolved.decision, occurredAt, entries);
  }

  public read(requestValue: WorkspaceReadRequest, occurredAt: string): WorkspaceToolExecution<{ content: string; contentHash: string }> {
    const request = workspaceReadRequestSchema.parse(requestValue);
    const resolved = this.#resolve(request.relativePath, "read", false);
    if (!resolved.decision.allowed || !resolved.absolutePath) {
      return this.#execution(request.requestId, "read", resolved.decision, occurredAt);
    }
    const stats = statSync(resolved.absolutePath);
    if (!stats.isFile()) {
      return this.#execution(request.requestId, "read", { ...resolved.decision, allowed: false, reason: "not_file" }, occurredAt);
    }
    if (stats.size > this.#policy.maxFileSizeBytes) {
      return this.#execution(request.requestId, "read", { ...resolved.decision, allowed: false, reason: "file_too_large" }, occurredAt);
    }
    const content = readFileSync(resolved.absolutePath, "utf8");
    return this.#execution(request.requestId, "read", resolved.decision, occurredAt, {
      content,
      contentHash: sha256(content),
    });
  }

  public search(requestValue: WorkspaceSearchRequest, occurredAt: string): WorkspaceToolExecution<readonly WorkspaceSearchMatch[]> {
    const request = workspaceSearchRequestSchema.parse(requestValue);
    const resolved = this.#resolve(request.relativePath, "read", false);
    if (!resolved.decision.allowed || !resolved.absolutePath) {
      return this.#execution(request.requestId, "search", resolved.decision, occurredAt);
    }
    const filePaths = statSync(resolved.absolutePath).isFile()
      ? [{ relativePath: resolved.normalizedRelativePath as string, absolutePath: resolved.absolutePath }]
      : this.#walkFiles(resolved.normalizedRelativePath as string).map((file) => ({
          relativePath: file.relativePath,
          absolutePath: join(this.#root, ...file.relativePath.split("/")),
        }));
    const matches: WorkspaceSearchMatch[] = [];
    for (const file of filePaths) {
      const content = readFileSync(file.absolutePath, "utf8");
      for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(request.literalQuery)) {
          matches.push({
            relativePath: file.relativePath,
            line: lineIndex + 1,
            preview: redactToolText(line).slice(0, 500),
          });
          if (matches.length >= request.maxResults) {
            return this.#execution(request.requestId, "search", resolved.decision, occurredAt, matches);
          }
        }
      }
    }
    return this.#execution(request.requestId, "search", resolved.decision, occurredAt, matches);
  }

  public patch(requestValue: WorkspacePatchRequest, occurredAt: string): WorkspaceToolExecution<WorkspacePatchOutcome> {
    const request = workspacePatchRequestSchema.parse(requestValue);
    const resolved = this.#resolve(request.relativePath, "write", request.operation === "create");
    if (!resolved.decision.allowed || !resolved.absolutePath || !resolved.normalizedRelativePath) {
      return this.#execution(request.requestId, "patch", resolved.decision, occurredAt);
    }
    if (request.operation === "delete" && !request.confirmationId) {
      return this.#execution(request.requestId, "patch", { ...resolved.decision, allowed: false, reason: "confirmation_required" }, occurredAt);
    }
    const exists = existsSync(resolved.absolutePath);
    if ((request.operation === "create" && exists) || (request.operation !== "create" && !exists)) {
      return this.#execution(request.requestId, "patch", { ...resolved.decision, allowed: false, reason: "hash_conflict" }, occurredAt);
    }
    const beforeContent = exists ? readFileSync(resolved.absolutePath) : undefined;
    const beforeHash = beforeContent ? sha256(beforeContent) : undefined;
    if (request.expectedBeforeHash && beforeHash !== request.expectedBeforeHash) {
      return this.#execution(request.requestId, "patch", { ...resolved.decision, allowed: false, reason: "hash_conflict" }, occurredAt);
    }
    if (request.operation === "delete") {
      unlinkSync(resolved.absolutePath);
      return this.#execution(request.requestId, "patch", resolved.decision, occurredAt, {
        relativePath: resolved.normalizedRelativePath,
        ...(beforeHash ? { beforeHash } : {}),
      });
    }
    const content = request.content as string;
    if (Buffer.byteLength(content) > this.#policy.maxFileSizeBytes) {
      return this.#execution(request.requestId, "patch", { ...resolved.decision, allowed: false, reason: "file_too_large" }, occurredAt);
    }
    writeFileSync(resolved.absolutePath, content, { encoding: "utf8", flag: request.operation === "create" ? "wx" : "w" });
    return this.#execution(request.requestId, "patch", resolved.decision, occurredAt, {
      relativePath: resolved.normalizedRelativePath,
      ...(beforeHash ? { beforeHash } : {}),
      afterHash: sha256(content),
    });
  }

  #resolve(relativePath: string, access: "read" | "write", allowMissing: boolean): ResolvedWorkspacePath {
    const lexical = evaluateWorkspacePath(relativePath, this.#policy);
    if (!lexical.allowed || !lexical.normalizedRelativePath) {
      return { decision: lexical };
    }
    const normalized = lexical.normalizedRelativePath;
    if (
      access === "write" &&
      (basename(normalized).toLowerCase() === "agents.md" ||
        normalized.split("/").some((part) => [".agents", ".codex", ".git"].includes(part.toLowerCase())))
    ) {
      return { decision: { ...lexical, allowed: false, reason: "operation_denied" } };
    }
    const absolutePath = normalized === "." ? this.#root : join(this.#root, ...normalized.split("/"));
    if (!isWithin(this.#root, absolutePath)) {
      return { decision: { ...lexical, allowed: false, reason: "outside_workspace" } };
    }
    let cursor = this.#root;
    const segments = normalized === "." ? [] : normalized.split("/");
    for (const segment of segments) {
      cursor = join(cursor, segment);
      if (!existsSync(cursor)) {
        break;
      }
      if (lstatSync(cursor).isSymbolicLink()) {
        return { decision: { ...lexical, allowed: false, reason: "symlink_rejected" } };
      }
    }
    if (existsSync(absolutePath)) {
      const canonicalTarget = realpathSync(absolutePath);
      if (!isWithin(this.#root, canonicalTarget)) {
        return { decision: { ...lexical, allowed: false, reason: "outside_workspace" } };
      }
    } else {
      if (!allowMissing) {
        return { decision: { ...lexical, allowed: false, reason: "not_found" } };
      }
      const parentPath = dirname(absolutePath);
      if (!existsSync(parentPath)) {
        return { decision: { ...lexical, allowed: false, reason: "not_found" } };
      }
      const parent = realpathSync(parentPath);
      if (!isWithin(this.#root, parent)) {
        return { decision: { ...lexical, allowed: false, reason: "outside_workspace" } };
      }
    }
    return { decision: lexical, absolutePath, normalizedRelativePath: normalized };
  }

  #walkFiles(relativeRoot: string): readonly { relativePath: string; sizeBytes: number; hash: string }[] {
    const start = relativeRoot === "." ? this.#root : join(this.#root, ...relativeRoot.split("/"));
    const files: { relativePath: string; sizeBytes: number; hash: string }[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = join(directory, entry.name);
        const relativePath = relative(this.#root, absolutePath).split(sep).join("/");
        const pathDecision = evaluateWorkspacePath(relativePath, this.#policy);
        if (!pathDecision.allowed || entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        const stats = statSync(absolutePath);
        if (stats.size > this.#policy.maxFileSizeBytes) {
          continue;
        }
        files.push({
          relativePath: pathDecision.normalizedRelativePath as string,
          sizeBytes: stats.size,
          hash: sha256(readFileSync(absolutePath)),
        });
        if (files.length > this.#policy.maxFiles) {
          throw new Error("Workspace file limit exceeded");
        }
      }
    };
    visit(start);
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  #execution<T>(
    requestId: string,
    operation: ToolEvent["operation"],
    pathDecision: WorkspacePathDecision,
    occurredAt: string,
    value?: T,
  ): WorkspaceToolExecution<T> {
    const disposition = pathDecision.allowed ? "allowed" : pathDecision.reason === "confirmation_required" ? "requires_confirmation" : "denied";
    const decisionId = `path-decision:${sha256([requestId, operation, pathDecision.reason].join(":" )).slice(0, 40)}`;
    const event = toolEventSchema.parse({
      eventId: `tool-event:${sha256([decisionId, occurredAt].join(":" )).slice(0, 40)}`,
      requestId,
      decisionId,
      operation,
      disposition,
      redactedArguments: ["<workspace-relative-path>"],
      resultSummary: pathDecision.allowed ? `${operation} completed` : `${operation} denied: ${pathDecision.reason}`,
      occurredAt,
    });
    this.#events.push(event);
    return { decision: pathDecision, event, ...(value === undefined ? {} : { value }) };
  }
}
