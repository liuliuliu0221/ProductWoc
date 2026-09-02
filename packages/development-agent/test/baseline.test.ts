import { describe, expect, it } from "vitest";

import { developmentAgentBaseline } from "../src/index.js";

describe("development agent P3-05 boundary", () => {
  it("enables bounded repair without granting direct tools", () => {
    expect(developmentAgentBaseline).toMatchObject({
      milestone: "P3-05",
      modelRoutingEnabled: true,
      implementationAgentEnabled: true,
      repairAgentEnabled: true,
      toolCallsEnabled: false,
    });
  });
});
