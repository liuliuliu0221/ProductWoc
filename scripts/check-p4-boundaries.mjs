import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const developmentPage = readFileSync(
  join(root, "apps/development-lab/src/web-page.ts"),
  "utf8",
);
const planningPage = readFileSync(
  join(root, "apps/planning-lab/src/web-page.ts"),
  "utf8",
);
const developmentServer = readFileSync(
  join(root, "apps/development-lab/src/web-server.ts"),
  "utf8",
);

const violations = [];
const forbiddenBrowserPatterns = [
  {
    name: "model-policy mutation endpoint",
    pattern: /\/api\/(?:development|session)\/(?:stage-model|model-policy|models\/configure)/i,
  },
  {
    name: "model-policy save control",
    pattern: /save-stage-models|canConfigureStageModels/i,
  },
  { name: "credential reference", pattern: /credentialRef/i },
  { name: "endpoint reference", pattern: /endpointRef/i },
  {
    name: "API key input",
    pattern: /(?:api[-_ ]?key|credential)["']?\s*(?:type|name|id)?\s*=/i,
  },
];

for (const [path, source] of [
  ["apps/planning-lab/src/web-page.ts", planningPage],
  ["apps/development-lab/src/web-page.ts", developmentPage],
]) {
  for (const { name, pattern } of forbiddenBrowserPatterns) {
    if (pattern.test(source)) {
      violations.push(`${path}: ${name} is forbidden in Web UI`);
    }
  }
}

if (!developmentServer.includes('if (action === "stage-model")')) {
  violations.push(
    "apps/development-lab/src/web-server.ts: legacy stage-model endpoint is not explicitly rejected",
  );
}
if (!developmentServer.includes('json(response, 404, { error: "not_found" })')) {
  violations.push(
    "apps/development-lab/src/web-server.ts: rejected model writes must return not_found",
  );
}

if (violations.length > 0) {
  process.stderr.write(`P4 boundary check failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "P4 boundary check passed: model configuration is operator-managed and absent from Web UI.\n",
  );
}
