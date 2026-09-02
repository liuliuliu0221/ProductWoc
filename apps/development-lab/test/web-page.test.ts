import { describe, expect, it } from "vitest";

import { renderDevelopmentPage } from "../src/web-page.js";

describe("Development Web page", () => {
  it("is keyboard accessible, responsive and exposes required local controls", () => {
    const page = renderDevelopmentPage();
    expect(page).toContain('href="#main"');
    expect(page).toContain(":focus-visible");
    expect(page).toContain("@media(max-width:620px)");
    expect(page).toContain("任务 DAG");
    expect(page).toContain("Patch 与 Diff");
    expect(page).toContain("验证、日志与 Evidence");
    expect(page).toContain("阶段模型覆盖（所有用户功能一致）");
    expect(page).toContain("save-stage-models");
    expect(page).toContain("/api/development/stage-model");
    expect(page).toContain("/api/development/start");
    expect(page).toContain("暂停");
    expect(page).toContain("恢复");
    expect(page).toContain("回滚当前 Patch");
  });

  it("emits syntactically valid browser JavaScript", () => {
    const page = renderDevelopmentPage();
    const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
  });

  it("has no remote release or production-write control", () => {
    const page = renderDevelopmentPage();
    expect(page).not.toMatch(/data-action=["'](?:deploy|publish|production)/i);
    expect(page).not.toContain("GitHub Push");
  });
});
