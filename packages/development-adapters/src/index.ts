export const developmentAdaptersBaseline = {
  milestone: "P3-06",
  modelProviderCallsEnabled: true,
  workspaceWritesEnabled: true,
  commandExecutionEnabled: true,
  verificationExecutionEnabled: true,
  guardedRollbackEnabled: true,
  durableCheckpointEnabled: true,
  remoteDeploymentEnabled: false,
} as const;

export * from "./command-runner.js";
export * from "./checkpoint-store.js";
export * from "./model-providers.js";
export * from "./patch-transaction.js";
export * from "./workspace-adapter.js";
export * from "./workspace-policy.js";
