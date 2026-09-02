import { join } from "node:path";

import { FileTransactionalCheckpointStore } from "@product-woc/planning-adapters";
import {
  createInMemoryStandalonePlanningPorts,
  runDurableStandalonePlanning,
  type DurableStandalonePlanningCheckpoint,
} from "@product-woc/planning-workflow";

const idea =
  process.argv
    .slice(2)
    .filter((argument) => argument !== "--")
    .join(" ")
    .trim() || "构建一个可恢复的本地客户反馈管理工具";
const workspaceId = process.env.PRODUCT_WOC_WORKSPACE_ID ?? "local-workspace";
const projectId = process.env.PRODUCT_WOC_PROJECT_ID ?? "local-durable-project";
const requestedBy = process.env.PRODUCT_WOC_USER_ID ?? "local-user";
const dataDirectory =
  process.env.PRODUCT_WOC_DATA_DIR ?? join(process.cwd(), ".product-woc", "checkpoints");
const store =
  new FileTransactionalCheckpointStore<DurableStandalonePlanningCheckpoint>(
    dataDirectory,
  );
const key = `${workspaceId}:${projectId}`;

try {
  const resumed = (await store.load(key)) !== null;
  const outcome = await runDurableStandalonePlanning(
    {
      workspaceId,
      projectId,
      requestedBy,
      requestId: `local-durable-request:${projectId}`,
      idea,
    },
    createInMemoryStandalonePlanningPorts(),
    store,
  );
  if (outcome.status !== "completed") {
    throw new Error(`Unexpected pause at ${outcome.checkpoint.aggregate.snapshot.status}`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "standalone-durable",
        externalServicesUsed: [],
        resumed,
        dataDirectory,
        checkpointRevision: outcome.checkpointRevision,
        status: outcome.result.aggregate.snapshot.status,
        developmentStartEnvelope: outcome.result.developmentStart,
        pendingOutboxEvents: (await store.pendingOutbox(key)).length,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Durable standalone planning failed: ${message}\n`);
  process.exitCode = 1;
}
