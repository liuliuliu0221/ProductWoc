import { describe, expect, it } from "vitest";

import { developmentAdaptersBaseline } from "../src/index.js";

describe("development adapters P3-06 boundary", () => {
  it("enables local verification and rollback while keeping deployment disabled", () => {
    expect(developmentAdaptersBaseline).toMatchObject({
      milestone: "P3-06",
      modelProviderCallsEnabled: true,
      workspaceWritesEnabled: true,
      commandExecutionEnabled: true,
      verificationExecutionEnabled: true,
      guardedRollbackEnabled: true,
      durableCheckpointEnabled: true,
      remoteDeploymentEnabled: false,
    });
  });
});
