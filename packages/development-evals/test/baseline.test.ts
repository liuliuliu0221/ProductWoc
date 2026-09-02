import { describe, expect, it } from "vitest";

import { developmentEvalsBaseline } from "../src/index.js";

describe("development evals P3-08 boundary", () => {
  it("advances the deterministic baseline to Gate G3", () => {
    expect(developmentEvalsBaseline).toEqual({
      milestone: "P3-08",
      gate: "G3",
      deterministicOnly: true,
      releaseLicenseRequired: true,
    });
  });
});
