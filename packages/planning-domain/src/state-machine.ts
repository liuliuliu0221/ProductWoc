import type { PlanningStatusV2 } from "@product-woc/planning-contracts";

const allowedTransitions: Readonly<
  Record<PlanningStatusV2, readonly PlanningStatusV2[]>
> = {
  collecting_idea: ["analyzing_request", "cancelled"],
  analyzing_request: [
    "awaiting_clarification",
    "generating_product_spec",
    "needs_user_action",
    "cancelled",
  ],
  awaiting_clarification: [
    "analyzing_request",
    "generating_product_spec",
    "cancelled",
  ],
  generating_product_spec: [
    "awaiting_product_spec_approval",
    "needs_user_action",
    "cancelled",
  ],
  awaiting_product_spec_approval: [
    "generating_product_spec",
    "generating_technical_design",
    "cancelled",
  ],
  generating_technical_design: [
    "awaiting_technical_design_approval",
    "needs_user_action",
    "cancelled",
  ],
  awaiting_technical_design_approval: [
    "generating_technical_design",
    "generating_product_spec",
    "generating_execution_plan",
    "cancelled",
  ],
  generating_execution_plan: [
    "awaiting_execution_plan_approval",
    "needs_user_action",
    "cancelled",
  ],
  awaiting_execution_plan_approval: [
    "generating_execution_plan",
    "generating_technical_design",
    "generating_product_spec",
    "ready_for_development",
    "cancelled",
  ],
  needs_user_action: [
    "analyzing_request",
    "generating_product_spec",
    "generating_technical_design",
    "generating_execution_plan",
    "cancelled",
  ],
  ready_for_development: [
    "generating_product_spec",
    "generating_technical_design",
    "generating_execution_plan",
  ],
  cancelled: [],
};

export function canTransition(
  from: PlanningStatusV2,
  to: PlanningStatusV2,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function allowedTransitionsFor(
  status: PlanningStatusV2,
): readonly PlanningStatusV2[] {
  return allowedTransitions[status];
}

export class InvalidPlanningTransitionError extends Error {
  public constructor(from: PlanningStatusV2, to: PlanningStatusV2) {
    super(`Invalid planning transition: ${from} -> ${to}`);
    this.name = "InvalidPlanningTransitionError";
  }
}

export function assertTransition(
  from: PlanningStatusV2,
  to: PlanningStatusV2,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidPlanningTransitionError(from, to);
  }
}
