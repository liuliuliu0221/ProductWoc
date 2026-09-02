import { z } from "zod";

import {
  idSchema,
  planningWorkflowInputV2Schema,
  type PlanningWorkflowInputV2,
} from "./index.js";

export const PRODUCTFAC_PLANNING_V1_SOURCE_SCHEMA_HASH =
  "f4317067daf9220b4a76d47ef1c4db153006b4860ca1953b64e0ffca912e762a";

export const planningWorkflowInputV1Schema = z
  .object({
    projectId: idSchema,
    idea: z.string().trim().min(3).max(4000),
    requestedBy: idSchema,
  })
  .strict();

export type PlanningWorkflowInputV1 = z.infer<
  typeof planningWorkflowInputV1Schema
>;

export interface PlanningV1AdapterContext {
  workspaceId: string;
  requestId: string;
  workflowVersion: string;
  approvalPolicyVersion: string;
}

export function adaptPlanningInputV1ToV2(
  input: PlanningWorkflowInputV1,
  context: PlanningV1AdapterContext,
): PlanningWorkflowInputV2 {
  return planningWorkflowInputV2Schema.parse({
    ...input,
    ...context,
  });
}
