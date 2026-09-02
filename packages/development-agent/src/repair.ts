import {
  repairContextSnapshotSchema,
  repairDecisionSchema,
  repairSessionSchema,
  taskContextSnapshotSchema,
  verificationEvidenceSchema,
  type RepairDecision,
  type RepairSession,
  type TaskContextSnapshot,
  type VerificationEvidence,
  type VerificationErrorCategory,
} from "@product-woc/development-contracts";
import { contentHash } from "@product-woc/development-domain";

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

export function createRepairSession(input: {
  repairSessionId: string;
  developmentRunId: string;
  taskRunId: string;
  maxAttempts?: number;
  createdAt: string;
}): Readonly<RepairSession> {
  return deepFreeze(
    repairSessionSchema.parse({
      repairSessionId: input.repairSessionId,
      developmentRunId: input.developmentRunId,
      taskRunId: input.taskRunId,
      maxAttempts: input.maxAttempts ?? 2,
      attempts: [],
      status: "available",
      updatedAt: input.createdAt,
    }),
  );
}

function stopped(
  session: RepairSession,
  reason: Exclude<RepairDecision["reason"], "repair_allowed">,
  updatedAt: string,
): Readonly<RepairDecision> {
  const stopReason =
    reason === "budget_exhausted"
      ? "budget_exhausted"
      : reason === "repeated_failure"
        ? "repeated_failure"
        : reason === "policy_failure"
          ? "policy_failure"
          : "infrastructure_failure";
  return deepFreeze(
    repairDecisionSchema.parse({
      allowed: false,
      reason,
      session: {
        ...session,
        status: "needs_user_action",
        stopReason,
        updatedAt,
      },
    }),
  );
}

function failureFingerprint(evidence: VerificationEvidence): string {
  return contentHash([
    evidence.verificationStepId,
    evidence.errorCategory,
    evidence.artifactHash,
    evidence.summary,
  ]);
}

function redactedFailureSummary(value: string): string {
  return value
    .replace(/\/Users\/[^/\s]+/g, "<home>")
    .replace(/\/home\/[^/\s]+/g, "<home>")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, "<home>")
    .replace(
      /(?:sk|pk|api|token|secret|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}/gi,
      "[REDACTED]",
    )
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /(?:password|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED EMAIL]");
}

export function requestRepair(input: {
  session: RepairSession;
  sourceContext: TaskContextSnapshot;
  failureEvidence: VerificationEvidence;
  repairAttemptId: string;
  repairContextId: string;
  agentRunId: string;
  modelSnapshotId: string;
  patchSetId: string;
  createdAt: string;
}): Readonly<RepairDecision> {
  const session = repairSessionSchema.parse(input.session);
  const evidence = verificationEvidenceSchema.parse(input.failureEvidence);
  const sourceContext = taskContextSnapshotSchema.parse(input.sourceContext);
  const { contextHash: sourceContextHash, ...sourceContextWithoutHash } =
    sourceContext;
  if (
    session.status !== "available" ||
    evidence.outcome !== "failed" ||
    evidence.errorCategory === "none" ||
    evidence.developmentRunId !== session.developmentRunId ||
    evidence.taskRunId !== session.taskRunId ||
    sourceContext.developmentRunId !== session.developmentRunId ||
    sourceContext.taskRunId !== session.taskRunId ||
    contentHash(sourceContextWithoutHash) !== sourceContextHash
  ) {
    throw new Error("Repair input does not match a failed Task verification");
  }
  if (evidence.errorCategory === "policy_denied") {
    return stopped(session, "policy_failure", input.createdAt);
  }
  if (
    evidence.errorCategory === "command_not_found" ||
    evidence.errorCategory === "timeout" ||
    evidence.errorCategory === "infrastructure_failure"
  ) {
    return stopped(session, "infrastructure_failure", input.createdAt);
  }
  const fingerprint = failureFingerprint(evidence);
  if (
    session.attempts.some(
      ({ failureFingerprint: previous }) => previous === fingerprint,
    )
  ) {
    return stopped(session, "repeated_failure", input.createdAt);
  }
  if (session.attempts.length >= session.maxAttempts) {
    return stopped(session, "budget_exhausted", input.createdAt);
  }

  const errorCategory = evidence.errorCategory as Exclude<
    VerificationErrorCategory,
    "none"
  >;
  const attempt = {
    repairAttemptId: input.repairAttemptId,
    attemptNumber: session.attempts.length + 1,
    agentRunId: input.agentRunId,
    modelSnapshotId: input.modelSnapshotId,
    patchSetId: input.patchSetId,
    failureEvidenceId: evidence.evidenceId,
    failureFingerprint: fingerprint,
    errorCategory,
    status: "proposed" as const,
    createdAt: input.createdAt,
  };
  const contextWithoutHash = {
    repairContextId: input.repairContextId,
    repairSessionId: session.repairSessionId,
    developmentRunId: session.developmentRunId,
    taskRunId: session.taskRunId,
    sourceContextSnapshotId: sourceContext.contextSnapshotId,
    sourceContextHash: sourceContext.contextHash,
    failureEvidenceId: evidence.evidenceId,
    failureArtifactHash: evidence.artifactHash,
    failureFingerprint: fingerprint,
    errorCategory,
    redactedFailureSummary: redactedFailureSummary(evidence.summary),
    previousRepairAttemptIds: session.attempts.map(
      ({ repairAttemptId }) => repairAttemptId,
    ),
    allowedWritePaths: sourceContext.allowedWritePaths,
    createdAt: input.createdAt,
  };
  const context = repairContextSnapshotSchema.parse({
    ...contextWithoutHash,
    contextHash: contentHash(contextWithoutHash),
  });
  return deepFreeze(
    repairDecisionSchema.parse({
      allowed: true,
      reason: "repair_allowed",
      attempt,
      context,
      session: {
        ...session,
        attempts: [...session.attempts, attempt],
        status: "repairing",
        updatedAt: input.createdAt,
      },
    }),
  );
}

export function recordRepairAttemptStatus(input: {
  session: RepairSession;
  repairAttemptId: string;
  status: "patch_applied" | "verification_failed" | "verified";
  completedAt: string;
}): Readonly<RepairSession> {
  const session = repairSessionSchema.parse(input.session);
  const index = session.attempts.findIndex(
    ({ repairAttemptId }) => repairAttemptId === input.repairAttemptId,
  );
  const current = session.attempts[index];
  const validTransition =
    current?.status === "proposed"
      ? input.status === "patch_applied"
      : current?.status === "patch_applied"
        ? input.status === "verification_failed" || input.status === "verified"
        : false;
  if (index < 0 || session.status !== "repairing" || !validTransition) {
    throw new Error("Repair Attempt is not active");
  }
  const attempts = session.attempts.map((attempt, attemptIndex) =>
    attemptIndex === index
      ? {
          ...attempt,
          status: input.status,
          ...(input.status === "patch_applied"
            ? {}
            : { completedAt: input.completedAt }),
        }
      : attempt,
  );
  const budgetExhausted =
    input.status === "verification_failed" &&
    attempts.length >= session.maxAttempts;
  return deepFreeze(
    repairSessionSchema.parse({
      ...session,
      attempts,
      status:
        input.status === "verified"
          ? "verified"
          : budgetExhausted
            ? "needs_user_action"
            : input.status === "verification_failed"
              ? "available"
              : "repairing",
      ...(budgetExhausted ? { stopReason: "budget_exhausted" } : {}),
      updatedAt: input.completedAt,
    }),
  );
}
