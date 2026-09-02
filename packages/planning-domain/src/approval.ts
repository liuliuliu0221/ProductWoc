import type { ApprovalBindingV2 } from "@product-woc/planning-contracts";
import type { PlanningSubject } from "@product-woc/planning-contracts";

export interface ApprovalSubject {
  projectId: string;
  workflowRunId: string;
  subjectType: PlanningSubject;
  versionId: string;
  hash: string;
  approvalPolicyVersion: string;
}

export type ApprovalValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason:
        | "project_mismatch"
        | "workflow_mismatch"
        | "subject_mismatch"
        | "policy_mismatch";
    };

export function validateApprovalBinding(
  approval: ApprovalBindingV2,
  subject: ApprovalSubject,
): ApprovalValidationResult {
  if (approval.projectId !== subject.projectId) {
    return { valid: false, reason: "project_mismatch" };
  }
  if (approval.workflowRunId !== subject.workflowRunId) {
    return { valid: false, reason: "workflow_mismatch" };
  }
  if (
    approval.subjectType !== subject.subjectType ||
    approval.subjectVersionId !== subject.versionId ||
    approval.subjectHash !== subject.hash
  ) {
    return { valid: false, reason: "subject_mismatch" };
  }
  if (approval.approvalPolicyVersion !== subject.approvalPolicyVersion) {
    return { valid: false, reason: "policy_mismatch" };
  }

  return { valid: true };
}
