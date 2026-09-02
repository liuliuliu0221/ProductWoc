export type PlanningSubject =
  | "project_spec"
  | "technical_design"
  | "execution_plan";

export interface InvalidationTarget {
  subject: PlanningSubject;
  invalidateDocument: boolean;
  invalidateApproval: boolean;
  invalidateContext: boolean;
  invalidateEvidence: boolean;
  invalidateDevelopmentStart: boolean;
}

const downstreamInvalidation: Record<PlanningSubject, readonly InvalidationTarget[]> = {
  project_spec: [
    {
      subject: "project_spec",
      invalidateDocument: false,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
    {
      subject: "technical_design",
      invalidateDocument: true,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
    {
      subject: "execution_plan",
      invalidateDocument: true,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
  ],
  technical_design: [
    {
      subject: "technical_design",
      invalidateDocument: false,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
    {
      subject: "execution_plan",
      invalidateDocument: true,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
  ],
  execution_plan: [
    {
      subject: "execution_plan",
      invalidateDocument: false,
      invalidateApproval: true,
      invalidateContext: true,
      invalidateEvidence: true,
      invalidateDevelopmentStart: true,
    },
  ],
};

export function invalidationTargetsFor(
  changedSubject: PlanningSubject,
): readonly InvalidationTarget[] {
  return downstreamInvalidation[changedSubject];
}
