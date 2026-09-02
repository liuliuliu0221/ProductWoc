import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  changeProposalSchema,
  patchJournalEntrySchema,
  patchPreviewSchema,
  patchRollbackResultSchema,
  patchTransactionResultSchema,
  taskContextSnapshotSchema,
  toolConfirmationSchema,
  type ChangeProposal,
  type PatchJournalEntry,
  type PatchJournalOperation,
  type PatchPreview,
  type PatchRollbackFileResult,
  type PatchRollbackResult,
  type PatchTransactionReason,
  type PatchTransactionResult,
  type ProposalFileOperation,
  type TaskContextSnapshot,
  type ToolConfirmation,
} from "@product-woc/development-contracts";

import type { NodeWorkspaceAdapter } from "./workspace-adapter.js";
import { evaluateWorkspacePath } from "./workspace-policy.js";

const MAX_PATCH_BYTES = 5_000_000;
const MAX_FILE_BYTES = 1_000_000;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts JSON-compatible values only");
}

function canonicalHash(value: unknown): string {
  return sha256(canonicalize(value));
}

function normalizedPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

function isProtectedWritePath(value: string): boolean {
  const segments = normalizedPath(value).toLowerCase().split("/");
  return (
    segments.at(-1) === "agents.md" ||
    segments.some((segment) => [".agents", ".codex", ".git"].includes(segment))
  );
}

function isWithinScope(relativePath: string, scope: string): boolean {
  const path = normalizedPath(relativePath);
  const normalizedScope = normalizedPath(scope);
  if (normalizedScope === "**") {
    return true;
  }
  if (normalizedScope.endsWith("/**")) {
    const prefix = normalizedScope.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (scope.replaceAll("\\", "/").endsWith("/")) {
    return path.startsWith(`${normalizedScope}/`);
  }
  return path === normalizedScope;
}

function hasBinaryControlCharacters(content: string): boolean {
  return [...content].some((character) => {
    const code = character.codePointAt(0) as number;
    return code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  });
}

function hasSensitiveMaterial(content: string): boolean {
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content) ||
    /(?:ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/iu.test(content) ||
    /AKIA[0-9A-Z]{16}/u.test(content) ||
    /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/iu.test(content)
  );
}

function hasCopyleftLicenseMaterial(content: string): boolean {
  return (
    /GNU (?:AFFERO )?GENERAL PUBLIC LICENSE/iu.test(content) ||
    /Server Side Public License/iu.test(content) ||
    /SPDX-License-Identifier:\s*(?:A?GPL|SSPL)-/iu.test(content)
  );
}

function isDependencyManifest(relativePath: string): boolean {
  return [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "bun.lock",
    "cargo.toml",
    "cargo.lock",
    "pyproject.toml",
    "uv.lock",
    "requirements.txt",
    "go.mod",
    "go.sum",
  ].includes(basename(relativePath).toLowerCase());
}

function validConfirmation(
  value: ToolConfirmation | undefined,
): value is ToolConfirmation {
  return value !== undefined && toolConfirmationSchema.safeParse(value).success;
}

function confirmationCovers(
  value: ToolConfirmation | undefined,
  paths: readonly string[],
  proposalId: string,
): boolean {
  if (!validConfirmation(value) || value.templateId !== proposalId) {
    return false;
  }
  const confirmed = new Set(value.relativePaths.map(normalizedPath));
  return paths.every((path) => confirmed.has(normalizedPath(path)));
}

function createPreview(proposal: ChangeProposal, createdAt: string): PatchPreview {
  const proposalHash = canonicalHash(proposal);
  const structured = proposal.operations.map((operation) => ({
    operation: operation.operation,
    relativePath: normalizedPath(operation.relativePath),
    beforeHash: operation.beforeHash ?? null,
    afterHash:
      operation.operation === "delete"
        ? null
        : sha256(operation.content as string),
    contentBytes:
      operation.operation === "delete"
        ? 0
        : Buffer.byteLength(operation.content as string, "utf8"),
    requirementIds: operation.requirementIds,
    designItemIds: operation.designItemIds,
  }));
  const structuredDiff = JSON.stringify(structured, null, 2);
  return patchPreviewSchema.parse({
    previewId: `patch-preview:${proposalHash.slice(0, 40)}`,
    proposalId: proposal.proposalId,
    proposalHash,
    fileCount: proposal.operations.length,
    totalContentBytes: proposal.operations.reduce(
      (total, operation) =>
        total +
        (operation.content === undefined
          ? 0
          : Buffer.byteLength(operation.content, "utf8")),
      0,
    ),
    structuredDiff,
    diffHash: sha256(structuredDiff),
    createdAt,
  });
}

interface PreflightOperation {
  proposal: ProposalFileOperation;
  relativePath: string;
  beforeContent?: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface ApplyPatchTransactionInput {
  patchSetId: string;
  idempotencyKey: string;
  proposal: ChangeProposal;
  context: TaskContextSnapshot;
  toolPolicyVersion: string;
  appliedAt: string;
  dependencyConfirmation?: ToolConfirmation;
  deleteConfirmation?: ToolConfirmation;
  licenseConfirmation?: ToolConfirmation;
}

export interface RollbackPatchTransactionInput {
  rollbackId: string;
  journalEntry: PatchJournalEntry;
  taskRunId: string;
  confirmation: ToolConfirmation;
  rolledBackAt: string;
}

export class PatchTransactionManager {
  readonly #workspace: NodeWorkspaceAdapter;
  readonly #journal: PatchJournalEntry[] = [];
  readonly #completed = new Map<string, PatchTransactionResult>();
  readonly #rollbacks = new Map<string, PatchRollbackResult>();
  #leaseOwner: string | undefined;

  public constructor(workspace: NodeWorkspaceAdapter) {
    this.#workspace = workspace;
  }

  public get journal(): readonly PatchJournalEntry[] {
    return [...this.#journal];
  }

  public reserve(taskRunId: string): boolean {
    if (this.#leaseOwner && this.#leaseOwner !== taskRunId) {
      return false;
    }
    this.#leaseOwner = taskRunId;
    return true;
  }

  public release(taskRunId: string): void {
    if (this.#leaseOwner === taskRunId) {
      this.#leaseOwner = undefined;
    }
  }

  public apply(input: ApplyPatchTransactionInput): PatchTransactionResult {
    const prior = this.#completed.get(input.idempotencyKey);
    if (prior) {
      return patchTransactionResultSchema.parse({
        ...prior,
        reason: "duplicate",
      });
    }

    const proposalResult = changeProposalSchema.safeParse(input.proposal);
    const contextResult = taskContextSnapshotSchema.safeParse(input.context);
    if (!proposalResult.success || !contextResult.success) {
      return this.#reject(input, "binding_mismatch");
    }
    const proposal = proposalResult.data;
    const context = contextResult.data;
    const preview = createPreview(proposal, input.appliedAt);
    const { contextHash, ...contextWithoutHash } = context;
    if (
      canonicalHash(contextWithoutHash) !== contextHash ||
      proposal.developmentRunId !== context.developmentRunId ||
      proposal.taskRunId !== context.taskRunId ||
      proposal.agentRunId !== context.agentRunId ||
      proposal.contextSnapshotId !== context.contextSnapshotId ||
      proposal.contextHash !== context.contextHash
    ) {
      return this.#reject(input, "binding_mismatch", preview);
    }
    if (this.#leaseOwner && this.#leaseOwner !== proposal.taskRunId) {
      return this.#reject(input, "single_writer_busy", preview);
    }

    const paths = proposal.operations.map(({ relativePath }) =>
      normalizedPath(relativePath),
    );
    const uniquePaths = new Set(paths);
    if (uniquePaths.size !== paths.length) {
      return this.#reject(input, "invalid_content", preview);
    }
    for (const path of paths) {
      const decision = evaluateWorkspacePath(path);
      if (
        !decision.allowed ||
        isProtectedWritePath(path) ||
        !context.allowedWritePaths.some((scope) => isWithinScope(path, scope))
      ) {
        return this.#reject(input, "path_denied", preview);
      }
    }

    const requirementIds = new Set(
      context.blocks
        .filter(({ kind }) => kind === "requirement")
        .map(({ sourceId }) => sourceId),
    );
    const designItemIds = new Set(
      context.blocks
        .filter(({ kind }) => kind === "design_item")
        .map(({ sourceId }) => sourceId),
    );
    if (
      proposal.operations.some(
        (operation) =>
          operation.requirementIds.some((id) => !requirementIds.has(id)) ||
          operation.designItemIds.some((id) => !designItemIds.has(id)),
      )
    ) {
      return this.#reject(input, "binding_mismatch", preview);
    }

    if (preview.totalContentBytes > MAX_PATCH_BYTES) {
      return this.#reject(input, "size_limit_exceeded", preview);
    }
    for (const operation of proposal.operations) {
      if (operation.content === undefined) {
        continue;
      }
      if (Buffer.byteLength(operation.content, "utf8") > MAX_FILE_BYTES) {
        return this.#reject(input, "size_limit_exceeded", preview);
      }
      if (hasBinaryControlCharacters(operation.content)) {
        return this.#reject(input, "binary_content_rejected", preview);
      }
      if (hasSensitiveMaterial(operation.content)) {
        return this.#reject(input, "sensitive_content_rejected", preview);
      }
    }

    const dependencyPaths = proposal.operations
      .filter(({ relativePath }) => isDependencyManifest(relativePath))
      .map(({ relativePath }) => relativePath);
    if (
      (proposal.dependencyChanges.length > 0 || dependencyPaths.length > 0) &&
      (!validConfirmation(input.dependencyConfirmation) ||
        input.dependencyConfirmation.templateId !== proposal.proposalId ||
        !confirmationCovers(
          input.dependencyConfirmation,
          dependencyPaths,
          proposal.proposalId,
        ))
    ) {
      return this.#reject(input, "dependency_confirmation_required", preview);
    }
    const deletedPaths = proposal.operations
      .filter(({ operation }) => operation === "delete")
      .map(({ relativePath }) => relativePath);
    if (
      deletedPaths.length > 0 &&
      !confirmationCovers(
        input.deleteConfirmation,
        deletedPaths,
        proposal.proposalId,
      )
    ) {
      return this.#reject(input, "delete_confirmation_required", preview);
    }
    const licensePaths = proposal.operations
      .filter(
        ({ content }) => content !== undefined && hasCopyleftLicenseMaterial(content),
      )
      .map(({ relativePath }) => relativePath);
    if (
      licensePaths.length > 0 &&
      !confirmationCovers(
        input.licenseConfirmation,
        licensePaths,
        proposal.proposalId,
      )
    ) {
      return this.#reject(input, "license_review_required", preview);
    }

    const preflight: PreflightOperation[] = [];
    for (const [index, operation] of proposal.operations.entries()) {
      const path = paths[index] as string;
      const read = this.#workspace.read(
        {
          requestId: `patch-read:${input.patchSetId}:${index}`,
          relativePath: path,
        },
        input.appliedAt,
      );
      if (operation.operation === "create") {
        if (read.value || read.decision.reason !== "not_found") {
          return this.#reject(input, "hash_conflict", preview, preflight);
        }
        preflight.push({
          proposal: operation,
          relativePath: path,
          afterHash: sha256(operation.content as string),
        });
        continue;
      }
      if (!read.value || read.value.contentHash !== operation.beforeHash) {
        return this.#reject(input, "hash_conflict", preview, preflight);
      }
      preflight.push({
        proposal: operation,
        relativePath: path,
        beforeContent: read.value.content,
        beforeHash: read.value.contentHash,
        ...(operation.operation === "update"
          ? { afterHash: sha256(operation.content as string) }
          : {}),
      });
    }

    const hadLease = this.#leaseOwner === proposal.taskRunId;
    if (!hadLease) {
      this.#leaseOwner = proposal.taskRunId;
    }
    const applied: PreflightOperation[] = [];
    try {
      for (const [index, operation] of preflight.entries()) {
        const outcome = this.#workspace.patch(
          {
            requestId: `patch-write:${input.patchSetId}:${index}`,
            relativePath: operation.relativePath,
            operation: operation.proposal.operation,
            ...(operation.beforeHash
              ? { expectedBeforeHash: operation.beforeHash }
              : {}),
            ...(operation.proposal.content === undefined
              ? {}
              : { content: operation.proposal.content }),
            ...(operation.proposal.operation === "delete"
              ? {
                  confirmationId: input.deleteConfirmation?.confirmationId,
                }
              : {}),
          },
          input.appliedAt,
        );
        if (!outcome.value || !outcome.decision.allowed) {
          throw new Error(`Patch operation ${index} was denied`);
        }
        applied.push(operation);
      }
    } catch {
      const rolledBack = this.#rollback(input, applied);
      if (!hadLease) {
        this.#leaseOwner = undefined;
      }
      return this.#reject(
        input,
        rolledBack
          ? "apply_failed_rolled_back"
          : "apply_failed_rollback_failed",
        preview,
        applied,
        rolledBack ? "rolled_back" : "rollback_failed",
      );
    }
    if (!hadLease) {
      this.#leaseOwner = undefined;
    }

    const journalEntry = this.#journalEntry(
      input,
      preview,
      preflight,
      "applied",
      true,
    );
    this.#journal.push(journalEntry);
    const result = patchTransactionResultSchema.parse({
      applied: true,
      reason: "applied",
      patchSetId: input.patchSetId,
      preview,
      journalEntry,
    });
    this.#completed.set(input.idempotencyKey, result);
    return result;
  }

  public rollback(
    input: RollbackPatchTransactionInput,
  ): PatchRollbackResult {
    const prior = this.#rollbacks.get(input.rollbackId);
    if (prior) {
      return prior;
    }
    const parsedJournal = patchJournalEntrySchema.safeParse(input.journalEntry);
    const parsedConfirmation = toolConfirmationSchema.safeParse(
      input.confirmation,
    );
    if (
      !parsedJournal.success ||
      parsedJournal.data.status !== "applied" ||
      parsedJournal.data.taskRunId !== input.taskRunId
    ) {
      return this.#rollbackResult(input, "binding_mismatch", []);
    }
    const journal = parsedJournal.data;
    const rollbackPaths = journal.operations.map(({ relativePath }) => relativePath);
    if (
      !parsedConfirmation.success ||
      parsedConfirmation.data.templateId !== journal.patchSetId ||
      !confirmationCovers(
        parsedConfirmation.data,
        rollbackPaths,
        journal.patchSetId,
      )
    ) {
      return this.#rollbackResult(input, "confirmation_required", []);
    }
    if (this.#leaseOwner && this.#leaseOwner !== input.taskRunId) {
      return this.#rollbackResult(input, "binding_mismatch", []);
    }

    const ordered = [...journal.operations].reverse();
    for (const [index, operation] of ordered.entries()) {
      const current = this.#workspace.read(
        {
          requestId: `user-rollback-read:${input.rollbackId}:${index}`,
          relativePath: operation.relativePath,
        },
        input.rolledBackAt,
      );
      if (operation.operation === "delete") {
        if (current.value || current.decision.reason !== "not_found") {
          return this.#rollbackResult(input, "hash_conflict", []);
        }
      } else if (
        !current.value ||
        !operation.afterHash ||
        current.value.contentHash !== operation.afterHash
      ) {
        return this.#rollbackResult(input, "hash_conflict", []);
      }
    }

    const hadLease = this.#leaseOwner === input.taskRunId;
    if (!hadLease) {
      this.#leaseOwner = input.taskRunId;
    }
    const applied: PatchRollbackFileResult[] = [];
    for (const [index, operation] of ordered.entries()) {
      const rollback = operation.rollback;
      try {
        const result = this.#workspace.patch(
          {
            requestId: `user-rollback-write:${input.rollbackId}:${index}`,
            relativePath: rollback.relativePath,
            operation: rollback.operation,
            ...(rollback.expectedBeforeHash
              ? { expectedBeforeHash: rollback.expectedBeforeHash }
              : {}),
            ...(rollback.content === undefined
              ? {}
              : { content: rollback.content }),
            ...(rollback.operation === "delete"
              ? {
                  confirmationId: parsedConfirmation.data.confirmationId,
                }
              : {}),
          },
          input.rolledBackAt,
        );
        if (!result.decision.allowed || !result.value) {
          if (!hadLease) {
            this.#leaseOwner = undefined;
          }
          return this.#rollbackResult(input, "apply_failed", applied);
        }
        applied.push({
          relativePath: rollback.relativePath,
          operation: rollback.operation,
          ...(result.value.beforeHash
            ? { beforeHash: result.value.beforeHash }
            : {}),
          ...(result.value.afterHash ? { afterHash: result.value.afterHash } : {}),
        });
      } catch {
        if (!hadLease) {
          this.#leaseOwner = undefined;
        }
        return this.#rollbackResult(input, "apply_failed", applied);
      }
    }
    if (!hadLease) {
      this.#leaseOwner = undefined;
    }
    const result = this.#rollbackResult(input, "rolled_back", applied);
    this.#rollbacks.set(input.rollbackId, result);
    return result;
  }

  #rollbackResult(
    input: RollbackPatchTransactionInput,
    reason: PatchRollbackResult["reason"],
    operations: readonly PatchRollbackFileResult[],
  ): PatchRollbackResult {
    const withoutHash = {
      rollbackId: input.rollbackId,
      patchSetId: input.journalEntry.patchSetId,
      journalEntryId: input.journalEntry.journalEntryId,
      taskRunId: input.taskRunId,
      rolledBack: reason === "rolled_back",
      reason,
      operations,
      rolledBackAt: input.rolledBackAt,
    };
    return patchRollbackResultSchema.parse({
      ...withoutHash,
      reportHash: canonicalHash(withoutHash),
    });
  }

  #rollback(
    input: ApplyPatchTransactionInput,
    operations: readonly PreflightOperation[],
  ): boolean {
    let completed = true;
    for (const [reverseIndex, operation] of [...operations].reverse().entries()) {
      const rollbackOperation =
        operation.proposal.operation === "create"
          ? "delete"
          : operation.proposal.operation === "delete"
            ? "create"
            : "update";
      try {
        const result = this.#workspace.patch(
          {
            requestId: `patch-rollback:${input.patchSetId}:${reverseIndex}`,
            relativePath: operation.relativePath,
            operation: rollbackOperation,
            ...(rollbackOperation === "update" || rollbackOperation === "delete"
              ? { expectedBeforeHash: operation.afterHash }
              : {}),
            ...(rollbackOperation === "create" || rollbackOperation === "update"
              ? { content: operation.beforeContent }
              : {}),
            ...(rollbackOperation === "delete"
              ? { confirmationId: `rollback:${input.patchSetId}` }
              : {}),
          },
          input.appliedAt,
        );
        completed &&= result.decision.allowed && result.value !== undefined;
      } catch {
        completed = false;
      }
    }
    return completed;
  }

  #reject(
    input: ApplyPatchTransactionInput,
    reason: Exclude<PatchTransactionReason, "applied" | "duplicate">,
    preview?: PatchPreview,
    operations: readonly PreflightOperation[] = [],
    status: "rejected" | "conflict" | "rolled_back" | "rollback_failed" =
      reason === "hash_conflict" ? "conflict" : "rejected",
  ): PatchTransactionResult {
    let journalEntry: PatchJournalEntry | undefined;
    if (preview) {
      journalEntry = this.#journalEntry(
        input,
        preview,
        operations,
        status,
        false,
      );
      this.#journal.push(journalEntry);
    }
    return patchTransactionResultSchema.parse({
      applied: false,
      reason,
      patchSetId: input.patchSetId,
      ...(preview ? { preview } : {}),
      ...(journalEntry ? { journalEntry } : {}),
    });
  }

  #journalEntry(
    input: ApplyPatchTransactionInput,
    preview: PatchPreview,
    operations: readonly PreflightOperation[],
    status: PatchJournalEntry["status"],
    rollbackAvailable: boolean,
  ): PatchJournalEntry {
    const proposal = input.proposal;
    const journalOperations: PatchJournalOperation[] = operations.map(
      (operation) => ({
        operation: operation.proposal.operation,
        relativePath: operation.relativePath,
        ...(operation.beforeHash ? { beforeHash: operation.beforeHash } : {}),
        ...(operation.afterHash ? { afterHash: operation.afterHash } : {}),
        rollback:
          operation.proposal.operation === "create"
            ? {
                operation: "delete",
                relativePath: operation.relativePath,
                expectedBeforeHash: operation.afterHash,
              }
            : operation.proposal.operation === "delete"
              ? {
                  operation: "create",
                  relativePath: operation.relativePath,
                  content: operation.beforeContent,
                }
              : {
                  operation: "update",
                  relativePath: operation.relativePath,
                  expectedBeforeHash: operation.afterHash,
                  content: operation.beforeContent,
                },
        requirementIds: operation.proposal.requirementIds,
        designItemIds: operation.proposal.designItemIds,
      }),
    );
    const beforeManifest = operations
      .map(({ relativePath, beforeHash }) => [relativePath, beforeHash ?? null])
      .sort(([left], [right]) => String(left).localeCompare(String(right)));
    const afterManifest = operations
      .map(({ relativePath, afterHash }) => [relativePath, afterHash ?? null])
      .sort(([left], [right]) => String(left).localeCompare(String(right)));
    const workspaceManifestBeforeHash = sha256(JSON.stringify(beforeManifest));
    const workspaceManifestAfterHash =
      status === "rolled_back"
        ? workspaceManifestBeforeHash
        : sha256(JSON.stringify(afterManifest));
    return patchJournalEntrySchema.parse({
      journalEntryId: `patch-journal:${sha256(
        `${input.patchSetId}:${status}:${this.#journal.length}`,
      ).slice(0, 40)}`,
      patchSetId: input.patchSetId,
      proposalId: proposal.proposalId,
      proposalHash: preview.proposalHash,
      idempotencyKey: input.idempotencyKey,
      developmentRunId: proposal.developmentRunId,
      taskRunId: proposal.taskRunId,
      agentRunId: proposal.agentRunId,
      contextSnapshotId: proposal.contextSnapshotId,
      modelSnapshotId: proposal.modelSnapshotId,
      status,
      operations: journalOperations,
      workspaceManifestBeforeHash,
      workspaceManifestAfterHash,
      diffHash: preview.diffHash,
      toolPolicyVersion: input.toolPolicyVersion,
      rollbackAvailable,
      appliedAt: input.appliedAt,
    });
  }
}
