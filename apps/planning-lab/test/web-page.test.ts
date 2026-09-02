import { describe, expect, it } from "vitest";

import { renderPlanningPage } from "../src/web-page.js";

describe("planning web page", () => {
  it("emits syntactically valid browser JavaScript", () => {
    const html = renderPlanningPage();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
  });

  it("provides the Planning to Development entry", () => {
    const html = renderPlanningPage();
    expect(html).toContain("进入 Development");
    expect(html).toContain("developmentUrl()");
    expect(html).toContain("target.port = '4273'");
  });
});
