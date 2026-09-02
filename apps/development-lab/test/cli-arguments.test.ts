import { describe, expect, it } from "vitest";

import { parseDevelopmentCliArguments } from "../src/cli-arguments.js";

describe("Development CLI arguments", () => {
  it("accepts pnpm's separator before the command", () => {
    expect(parseDevelopmentCliArguments(["--", "status"])).toEqual({
      command: "status",
      positional: [],
    });
  });

  it("preserves export output paths and defaults to status", () => {
    expect(parseDevelopmentCliArguments(["export-evidence", "/tmp/evidence.json"])).toEqual({
      command: "export-evidence",
      positional: ["/tmp/evidence.json"],
    });
    expect(parseDevelopmentCliArguments([])).toEqual({ command: "status", positional: [] });
  });
});
