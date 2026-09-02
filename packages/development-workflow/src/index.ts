export const developmentWorkflowBaseline = {
  milestone: "P3-06",
  schedulingEnabled: true,
  verificationEnabled: true,
  checkpointWritesEnabled: true,
  recoveryAuditEnabled: true,
} as const;

export * from "./verification.js";
export * from "./rollback.js";
export * from "./durable.js";
