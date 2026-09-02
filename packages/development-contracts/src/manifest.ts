import type { DevelopmentContractManifest } from "./index.js";

export const developmentWorkflowDefinitionIdentity = {
  workflowKey: "product-woc-development",
  workflowVersion: "1.0.0",
  stages: ["input_validation", "task_execution", "verification", "user_gate"],
  inputSchemaVersion: "1.0.0",
  eventSchemaVersion: "1.0.0",
  validationPolicyVersion: "1.0.0",
  toolPolicyVersion: "1.0.0",
} as const;

export const developmentContractManifest = {
  contractVersion: "1.0.0",
  sourceRevision: "product-woc-stage3-p3-06",
  workflowKey: "product-woc-development",
  workflowVersion: "1.0.0",
  definitionChecksum: "27d517e5dd6a01152a4bbf9a3e0e7777ac74f13a4a6b711662e76aa7bc15b531",
  inputSchemaVersion: "1.0.0",
  eventSchemaVersion: "1.0.0",
  validationPolicyVersion: "1.0.0",
  toolPolicyVersion: "1.0.0",
  minimumPlanningContractVersion: "2.0.0",
  minimumRuntimeCapability: "0.1.0",
} as const satisfies DevelopmentContractManifest;
