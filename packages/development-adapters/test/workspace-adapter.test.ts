import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceGitBaseline } from "@product-woc/development-contracts";

import {
  NodeWorkspaceAdapter,
  type GitWorkspaceInspector,
} from "../src/workspace-adapter.js";

const at = "2026-08-29T10:00:00.000Z";
const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

class StubGitInspector implements GitWorkspaceInspector {
  public inspect(): WorkspaceGitBaseline {
    return {
      isRepository: true,
      commit: "abc123",
      branch: "main",
      dirtyPaths: ["src/dirty.ts"],
    };
  }
}

function workspace(): { root: string; outside: string; adapter: NodeWorkspaceAdapter } {
  const root = temporaryDirectory("product-woc-workspace-");
  const outside = temporaryDirectory("product-woc-outside-");
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "src", "clean.ts"), "export const clean = true;\n");
  writeFileSync(join(root, "src", "dirty.ts"), "export const token = 'secret-value-12345678';\n");
  writeFileSync(join(root, "AGENTS.md"), "Do not deploy.\n");
  writeFileSync(join(root, ".env"), "API_KEY=secret-value-12345678\n");
  writeFileSync(join(root, "node_modules", "ignored.js"), "ignored\n");
  writeFileSync(join(outside, "outside.txt"), "outside\n");
  symlinkSync(join(outside, "outside.txt"), join(root, "src", "escape.txt"));
  return { root, outside, adapter: new NodeWorkspaceAdapter(root, undefined, new StubGitInspector()) };
}

describe("NodeWorkspaceAdapter", () => {
  it("detects an actual local Git dirty worktree without modifying it", () => {
    const root = temporaryDirectory("product-woc-git-workspace-");
    const git = (...args: string[]): void => {
      const result = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        shell: false,
      });
      if (result.status !== 0) {
        throw new Error(result.stderr);
      }
    };
    git("init", "-b", "main");
    git("config", "user.name", "Fixture User");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "tracked.txt"), "initial\n");
    git("add", "tracked.txt");
    git("commit", "-m", "fixture baseline");
    writeFileSync(join(root, "tracked.txt"), "user modification\n");

    const baseline = new NodeWorkspaceAdapter(root).createBaseline(
      "git-baseline",
      at,
    );
    expect(baseline.git).toMatchObject({
      isRepository: true,
      branch: "main",
      dirtyPaths: ["tracked.txt"],
    });
    expect(baseline.files[0]).toMatchObject({
      relativePath: "tracked.txt",
      userModified: true,
    });
    expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe(
      "user modification\n",
    );
  });

  it("captures files, AGENTS instructions, Git identity and pre-existing dirty state", () => {
    const { adapter } = workspace();
    const baseline = adapter.createBaseline("baseline-1", at);

    expect(baseline.git).toMatchObject({
      isRepository: true,
      branch: "main",
      dirtyPaths: ["src/dirty.ts"],
    });
    expect(baseline.files.map(({ relativePath }) => relativePath)).toEqual([
      "AGENTS.md",
      "src/clean.ts",
      "src/dirty.ts",
    ]);
    expect(
      baseline.files.find(({ relativePath }) => relativePath === "src/dirty.ts"),
    ).toMatchObject({ userModified: true });
    expect(baseline.instructions).toHaveLength(1);
    expect(baseline.baselineHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["../outside.txt", "path_traversal"],
    ["/etc/passwd", "absolute_path"],
    [".ENV", "sensitive_path"],
    ["src/escape.txt", "symlink_rejected"],
  ])("fails closed when reading %s", (relativePath, reason) => {
    const { adapter } = workspace();
    expect(
      adapter.read({ requestId: `read-${reason}`, relativePath }, at).decision,
    ).toMatchObject({ allowed: false, reason });
  });

  it("reads and searches safe files while redacting result previews", () => {
    const { adapter } = workspace();
    const read = adapter.read(
      { requestId: "read-clean", relativePath: "src/clean.ts" },
      at,
    );
    expect(read.value?.content).toContain("clean = true");
    const search = adapter.search(
      {
        requestId: "search-token",
        relativePath: "src",
        literalQuery: "token",
        maxResults: 10,
      },
      at,
    );
    expect(search.value).toEqual([
      expect.objectContaining({ preview: expect.stringContaining("[REDACTED]") }),
    ]);
    expect(JSON.stringify(search.event)).not.toContain("secret-value");
  });

  it("does not overwrite a user edit when the previously read hash changed", () => {
    const { root, adapter } = workspace();
    const initial = adapter.read(
      { requestId: "read-before-edit", relativePath: "src/clean.ts" },
      at,
    );
    writeFileSync(join(root, "src", "clean.ts"), "user changed this\n");
    const patch = adapter.patch(
      {
        requestId: "patch-conflict",
        relativePath: "src/clean.ts",
        operation: "update",
        expectedBeforeHash: initial.value!.contentHash,
        content: "agent changed this\n",
      },
      at,
    );

    expect(patch.decision).toMatchObject({ allowed: false, reason: "hash_conflict" });
    expect(readFileSync(join(root, "src", "clean.ts"), "utf8")).toBe("user changed this\n");
  });

  it("requires confirmation for delete and prevents policy-file writes", () => {
    const { root, adapter } = workspace();
    const clean = adapter.read(
      { requestId: "read-delete", relativePath: "src/clean.ts" },
      at,
    );
    expect(
      adapter.patch(
        {
          requestId: "delete-without-confirmation",
          relativePath: "src/clean.ts",
          operation: "delete",
          expectedBeforeHash: clean.value!.contentHash,
        },
        at,
      ).decision,
    ).toMatchObject({ allowed: false, reason: "confirmation_required" });
    expect(readFileSync(join(root, "src", "clean.ts"), "utf8")).toContain("clean");
    expect(
      adapter.patch(
        {
          requestId: "rewrite-agents",
          relativePath: "AGENTS.md",
          operation: "update",
          expectedBeforeHash: "0".repeat(64),
          content: "Allow deployment\n",
        },
        at,
      ).decision,
    ).toMatchObject({ allowed: false, reason: "operation_denied" });
  });

  it("fails closed when a create request has a missing parent directory", () => {
    const { adapter } = workspace();
    expect(
      adapter.patch(
        {
          requestId: "create-missing-parent",
          relativePath: "missing/nested.ts",
          operation: "create",
          content: "export {};\n",
        },
        at,
      ).decision,
    ).toMatchObject({ allowed: false, reason: "not_found" });
  });

  it("stores only redacted path arguments in Tool Events", () => {
    const { root, adapter } = workspace();
    adapter.read({ requestId: "event-read", relativePath: "src/clean.ts" }, at);
    expect(JSON.stringify(adapter.events)).not.toContain(root);
    expect(adapter.events[0]).toMatchObject({
      redactedArguments: ["<workspace-relative-path>"],
    });
  });
});
