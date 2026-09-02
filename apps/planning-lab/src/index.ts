import { planningContractManifest } from "@product-woc/planning-contracts";
import {
  renderExecutionPlanMarkdown,
  renderProjectSpecMarkdown,
  renderTechnicalDesignMarkdown,
} from "@product-woc/planning-renderer";
import {
  createInMemoryStandalonePlanningPorts,
  runAutoApprovedStandalonePlanning,
  type StandalonePlanningRequest,
} from "@product-woc/planning-workflow";

export function describePlanningLab(): string {
  return `Planning Lab (${planningContractManifest.workflowVersion})`;
}

export async function runPlanningLab(request: StandalonePlanningRequest) {
  const ports = createInMemoryStandalonePlanningPorts();
  const result = await runAutoApprovedStandalonePlanning(request, ports);
  return {
    result,
    events: ports.events.events,
    markdown: {
      projectSpec: renderProjectSpecMarkdown(result.projectSpec),
      technicalDesign: renderTechnicalDesignMarkdown(result.technicalDesign),
      executionPlan: renderExecutionPlanMarkdown(result.executionPlan),
    },
  };
}
