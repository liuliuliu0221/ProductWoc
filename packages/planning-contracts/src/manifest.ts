import type { PlanningContractManifest } from "./index.js";

export const planningWorkflowDefinitionIdentity = {
  workflowKey: "product-factory-planning",
  workflowVersion: "2.0.0",
  stages: [
    "discovery",
    "product_spec",
    "technical_design",
    "execution_plan",
  ],
  inputSchemaVersion: "2.0.0",
  eventSchemaVersion: "1.0.0",
  approvalPolicyVersion: "2.0.0",
} as const;

export const planningContractManifest = {
  contractVersion: "2.0.0",
  sourceRevision: "unversioned-productfac-contracts",
  sourceSchemaHash: "f4317067daf9220b4a76d47ef1c4db153006b4860ca1953b64e0ffca912e762a",
  workflowKey: "product-factory-planning",
  workflowVersion: "2.0.0",
  definitionChecksum: "6a1dc4b533081cb91abb2c9bb33507db80e825605e78b493fac2083e69d67f7a",
  inputSchemaVersion: "2.0.0",
  eventSchemaVersion: "1.0.0",
  approvalPolicyVersion: "2.0.0",
  minimumPlatformCapability: "1.2.0",
} as const satisfies PlanningContractManifest;
