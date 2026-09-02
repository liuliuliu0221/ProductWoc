import { runPlanningLab } from "./index.js";

const idea =
  process.argv
    .slice(2)
    .filter((argument) => argument !== "--")
    .join(" ")
    .trim() || "构建一个本地客户反馈管理工具";

try {
  const output = await runPlanningLab({
    workspaceId: "local-workspace",
    projectId: "local-project",
    requestedBy: "local-user",
    requestId: "local-request",
    idea,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "standalone",
        externalServicesUsed: [],
        status: output.result.aggregate.snapshot.status,
        workflowRunId: output.result.aggregate.snapshot.workflowRunId,
        versions: {
          projectSpec: output.result.projectSpec.versionId,
          technicalDesign: output.result.technicalDesign.versionId,
          executionPlan: output.result.executionPlan.versionId,
        },
        developmentStartEnvelope: output.result.developmentStart,
        eventCount: output.events.length,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Standalone planning failed: ${message}\n`);
  process.exitCode = 1;
}
