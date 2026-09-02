import { createHash } from "node:crypto";

import {
  evidenceManifestSchema,
  toolConfirmationSchema,
  verificationEvidenceSchema,
  verificationLogArtifactSchema,
  verificationRunResultSchema,
  type DevelopmentEvidenceType,
  type EvidenceManifest,
  type PatchJournalEntry,
  type TaskRun,
  type ToolConfirmation,
  type VerificationLogArtifact,
  type VerificationRunResult,
} from "@product-woc/development-contracts";
import {
  type NodeWorkspaceAdapter,
  redactToolText,
  type StructuredCommandRunner,
} from "@product-woc/development-adapters";
import {
  completeTask,
  recordTaskEvidence,
  taskDefinitionHash,
  type DevelopmentAggregate,
} from "@product-woc/development-domain";
import type {
  EvidenceType,
  ExecutionTask,
} from "@product-woc/planning-contracts";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mappedEvidenceType(type: EvidenceType): DevelopmentEvidenceType {
  const mapping: Readonly<Record<EvidenceType, DevelopmentEvidenceType>> = {
    test_report: "test_report",
    typecheck: "typecheck_report",
    lint_report: "lint_report",
    build_artifact: "build_report",
    screenshot: "screenshot",
    runtime_log: "runtime_log",
    security_report: "security_report",
    manual_approval: "manual_confirmation",
  };
  return mapping[type];
}

function isCommandEvidence(type: EvidenceType): boolean {
  return ["test_report", "typecheck", "lint_report", "build_artifact"].includes(
    type,
  );
}

function boundedArtifactContent(value: string): {
  content: string;
  truncated: boolean;
} {
  const redacted = redactToolText(value);
  const buffer = Buffer.from(redacted, "utf8");
  if (buffer.byteLength <= 4_000_000) {
    return { content: redacted, truncated: false };
  }
  return {
    content: buffer.subarray(0, 3_999_900).toString("utf8"),
    truncated: true,
  };
}

export interface VerificationTemplateMap {
  test_report?: string;
  typecheck?: string;
  lint_report?: string;
  build_artifact?: string;
}

export interface ManualVerificationRecord {
  verificationStepId: string;
  confirmation: ToolConfirmation;
  content: string;
  outcome: "passed" | "failed";
}

export interface RunTaskVerificationInput {
  verificationRunId: string;
  taskRun: TaskRun;
  executionTask: ExecutionTask;
  patchJournalEntry: PatchJournalEntry;
  templateMap: VerificationTemplateMap;
  cwdRelativePath: string;
  completedAt: string;
  manualRecords?: readonly ManualVerificationRecord[];
}

export class InMemoryVerificationArtifactRepository {
  readonly #artifacts = new Map<string, VerificationLogArtifact>();

  public append(artifact: VerificationLogArtifact): void {
    const parsed = verificationLogArtifactSchema.parse(artifact);
    const existing = this.#artifacts.get(parsed.artifactId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new Error("Verification Artifact ID already has different content");
    }
    this.#artifacts.set(parsed.artifactId, parsed);
  }

  public get(artifactId: string): VerificationLogArtifact | undefined {
    return this.#artifacts.get(artifactId);
  }

  public list(): readonly VerificationLogArtifact[] {
    return [...this.#artifacts.values()];
  }
}

export class TaskVerificationService {
  readonly #commands: StructuredCommandRunner;
  readonly #workspace: NodeWorkspaceAdapter;
  readonly #artifacts: InMemoryVerificationArtifactRepository;

  public constructor(
    commands: StructuredCommandRunner,
    workspace: NodeWorkspaceAdapter,
    artifacts = new InMemoryVerificationArtifactRepository(),
  ) {
    this.#commands = commands;
    this.#workspace = workspace;
    this.#artifacts = artifacts;
  }

  public get artifacts(): InMemoryVerificationArtifactRepository {
    return this.#artifacts;
  }

  public async run(
    input: RunTaskVerificationInput,
  ): Promise<VerificationRunResult> {
    const task = input.taskRun;
    const patch = input.patchJournalEntry;
    const currentAgentRunId = task.agentRunIds.at(-1);
    if (
      !["verifying", "repairing"].includes(task.status) ||
      !task.modelSnapshotId ||
      task.executionTaskId !== input.executionTask.id ||
      task.taskDefinitionHash !== taskDefinitionHash(input.executionTask) ||
      patch.status !== "applied" ||
      patch.developmentRunId !== task.developmentRunId ||
      patch.taskRunId !== task.taskRunId ||
      patch.agentRunId !== currentAgentRunId ||
      patch.modelSnapshotId !== task.modelSnapshotId
    ) {
      throw new Error("Verification input does not match the current Task Patch");
    }

    const evidenceDrafts: Record<string, unknown>[] = [];
    const artifacts: VerificationLogArtifact[] = [];
    for (const [index, step] of input.executionTask.verificationSteps.entries()) {
      const artifactId = `verification-artifact:${sha256(
        `${input.verificationRunId}:${step.id}`,
      ).slice(0, 40)}`;
      const evidenceId = `verification-evidence:${sha256(
        `${input.verificationRunId}:${step.id}`,
      ).slice(0, 40)}`;
      if (isCommandEvidence(step.evidenceType)) {
        const templateId = input.templateMap[step.evidenceType as keyof VerificationTemplateMap];
        const commandRequestId = `verification-command:${sha256(
          `${input.verificationRunId}:${step.id}`,
        ).slice(0, 40)}`;
        const result = await this.#commands.run(
          {
            requestId: commandRequestId,
            templateId: templateId ?? `missing-template:${index}`,
            cwdRelativePath: input.cwdRelativePath,
          },
          input.completedAt,
        );
        const rawLog = [
          `[stdout]\n${result.stdout ?? ""}`,
          `[stderr]\n${result.stderr ?? ""}`,
        ].join("\n");
        const bounded = boundedArtifactContent(rawLog);
        const artifact = verificationLogArtifactSchema.parse({
          artifactId,
          developmentRunId: task.developmentRunId,
          taskRunId: task.taskRunId,
          verificationStepId: step.id,
          commandRequestId,
          source: "command_output",
          content: bounded.content,
          contentHash: sha256(bounded.content),
          byteLength: Buffer.byteLength(bounded.content, "utf8"),
          truncated: bounded.truncated,
          redacted: true,
          createdAt: input.completedAt,
        });
        artifacts.push(artifact);
        const exitCode = result.exitCode ?? 126;
        evidenceDrafts.push({
            evidenceId,
            developmentRunId: task.developmentRunId,
            taskRunId: task.taskRunId,
            verificationStepId: step.id,
            taskDefinitionHash: task.taskDefinitionHash,
            modelSnapshotId: task.modelSnapshotId,
            type: mappedEvidenceType(step.evidenceType),
            producer: "verification_runner",
            artifactId,
            artifactHash: artifact.contentHash,
            patchJournalEntryId: patch.journalEntryId,
            commandResultHash: sha256(JSON.stringify(result)),
            exitCode,
            errorCategory: result.failureCategory,
            summary: result.event.resultSummary,
            outcome: result.executed && exitCode === 0 ? "passed" : "failed",
            producedAt: input.completedAt,
          });
        continue;
      }

      const manual = input.manualRecords?.find(
        ({ verificationStepId }) => verificationStepId === step.id,
      );
      const parsedConfirmation = manual
        ? toolConfirmationSchema.safeParse(manual.confirmation)
        : undefined;
      const confirmedManual =
        manual &&
        parsedConfirmation?.success === true &&
        parsedConfirmation.data.templateId === step.id
          ? { record: manual, confirmation: parsedConfirmation.data }
          : undefined;
      const bounded = boundedArtifactContent(
        confirmedManual
          ? confirmedManual.record.content
          : `Manual Evidence required: ${step.description}`,
      );
      const artifact = verificationLogArtifactSchema.parse({
        artifactId,
        developmentRunId: task.developmentRunId,
        taskRunId: task.taskRunId,
        verificationStepId: step.id,
        source: "manual_record",
        content: bounded.content,
        contentHash: sha256(bounded.content),
        byteLength: Buffer.byteLength(bounded.content, "utf8"),
        truncated: bounded.truncated,
        redacted: true,
        createdAt: input.completedAt,
      });
      artifacts.push(artifact);
      evidenceDrafts.push({
          evidenceId,
          developmentRunId: task.developmentRunId,
          taskRunId: task.taskRunId,
          verificationStepId: step.id,
          taskDefinitionHash: task.taskDefinitionHash,
          modelSnapshotId: task.modelSnapshotId,
          type: mappedEvidenceType(step.evidenceType),
          producer: confirmedManual ? "user" : "system",
          artifactId,
          artifactHash: artifact.contentHash,
          patchJournalEntryId: patch.journalEntryId,
          errorCategory:
            confirmedManual && confirmedManual.record.outcome === "passed"
              ? "none"
              : "policy_denied",
          summary: confirmedManual
            ? "Manual Evidence recorded"
            : "Manual Evidence is required",
          ...(confirmedManual
            ? { confirmationId: confirmedManual.confirmation.confirmationId }
            : {}),
          outcome: confirmedManual
            ? confirmedManual.record.outcome
            : "requires_review",
          producedAt: input.completedAt,
        });
    }

    const workspaceHash = this.#workspace.contentManifestHash();
    const evidence = evidenceDrafts.map((item) =>
      verificationEvidenceSchema.parse({ ...item, workspaceHash }),
    );
    for (const artifact of artifacts) {
      this.#artifacts.append(artifact);
    }
    const requiredVerificationStepIds = input.executionTask.verificationSteps
      .filter(({ required }) => required)
      .map(({ id }) => id);
    const passedRequiredStepIds = requiredVerificationStepIds.filter((stepId) =>
      evidence.some(
        ({ verificationStepId, outcome }) =>
          verificationStepId === stepId && outcome === "passed",
      ),
    );
    const status = evidence.some(({ outcome }) => outcome === "failed")
      ? "failed"
      : passedRequiredStepIds.length === requiredVerificationStepIds.length
        ? "passed"
        : "requires_review";
    const manifestWithoutHash = {
      manifestId: `evidence-manifest:${sha256(input.verificationRunId).slice(0, 40)}`,
      developmentRunId: task.developmentRunId,
      taskRunId: task.taskRunId,
      taskDefinitionHash: task.taskDefinitionHash,
      modelSnapshotId: task.modelSnapshotId,
      patchJournalEntryId: patch.journalEntryId,
      workspaceHash,
      evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
      requiredVerificationStepIds,
      passedRequiredStepIds,
      status,
      createdAt: input.completedAt,
    };
    const manifest = evidenceManifestSchema.parse({
      ...manifestWithoutHash,
      manifestHash: sha256(JSON.stringify(manifestWithoutHash)),
    });
    return verificationRunResultSchema.parse({
      verificationRunId: input.verificationRunId,
      developmentRunId: task.developmentRunId,
      taskRunId: task.taskRunId,
      manifest,
      evidence,
      artifacts,
      completedAt: input.completedAt,
    });
  }
}

function validManifestHash(manifest: EvidenceManifest): boolean {
  const { manifestHash, ...withoutHash } = manifest;
  return sha256(JSON.stringify(withoutHash)) === manifestHash;
}

export function recordVerificationResult(
  aggregate: DevelopmentAggregate,
  resultValue: VerificationRunResult,
): DevelopmentAggregate {
  const result = verificationRunResultSchema.parse(resultValue);
  const task = aggregate.taskRuns[result.taskRunId];
  const evidenceIds = new Set(result.evidence.map(({ evidenceId }) => evidenceId));
  const passedRequiredStepIds = result.manifest.requiredVerificationStepIds.filter(
    (stepId) =>
      result.evidence.some(
        ({ verificationStepId, outcome }) =>
          verificationStepId === stepId && outcome === "passed",
      ),
  );
  const expectedStatus = result.evidence.some(
    ({ outcome }) => outcome === "failed",
  )
    ? "failed"
    : passedRequiredStepIds.length ===
        result.manifest.requiredVerificationStepIds.length
      ? "passed"
      : "requires_review";
  if (
    !task ||
    result.developmentRunId !== aggregate.run.developmentRunId ||
    result.manifest.taskDefinitionHash !== task.taskDefinitionHash ||
    result.manifest.modelSnapshotId !== task.modelSnapshotId ||
    !validManifestHash(result.manifest) ||
    evidenceIds.size !== result.manifest.evidenceIds.length ||
    result.manifest.evidenceIds.some((id) => !evidenceIds.has(id)) ||
    JSON.stringify(passedRequiredStepIds) !==
      JSON.stringify(result.manifest.passedRequiredStepIds) ||
    result.manifest.status !== expectedStatus ||
    result.evidence.some(
      (evidence) =>
        !result.manifest.evidenceIds.includes(evidence.evidenceId) ||
        evidence.workspaceHash !== result.manifest.workspaceHash ||
        evidence.patchJournalEntryId !== result.manifest.patchJournalEntryId ||
        !result.artifacts.some(
          (artifact) =>
            artifact.artifactId === evidence.artifactId &&
            artifact.contentHash === evidence.artifactHash &&
            artifact.taskRunId === evidence.taskRunId &&
            artifact.verificationStepId === evidence.verificationStepId,
        ),
    )
  ) {
    throw new Error("Verification Result does not match the Development Task");
  }
  let next = aggregate;
  for (const [index, evidence] of result.evidence.entries()) {
    const execution = recordTaskEvidence(next, {
      requestId: `record-verification:${result.verificationRunId}:${index}`,
      evidence,
    });
    if (!execution.result.accepted) {
      throw new Error(`Evidence rejected: ${execution.result.reason}`);
    }
    next = execution.aggregate;
  }
  return next;
}

export function completeTaskFromVerification(
  aggregate: DevelopmentAggregate,
  resultValue: VerificationRunResult,
  completedAt: string,
): DevelopmentAggregate {
  const result = verificationRunResultSchema.parse(resultValue);
  if (result.manifest.status !== "passed") {
    return aggregate;
  }
  const recorded = recordVerificationResult(aggregate, result);
  const completion = completeTask(recorded, {
    requestId: `complete-verification:${result.verificationRunId}`,
    taskRunId: result.taskRunId,
    evidenceIds: result.manifest.evidenceIds,
    completedAt,
  });
  return completion.result.accepted ? completion.aggregate : recorded;
}
