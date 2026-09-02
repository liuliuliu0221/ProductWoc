export const developmentAgentBaseline = {
  milestone: "P3-05",
  modelRoutingEnabled: true,
  implementationAgentEnabled: true,
  repairAgentEnabled: true,
  toolCallsEnabled: false,
} as const;

export * from "./model-router.js";
export * from "./repair.js";
export * from "./task-context.js";
