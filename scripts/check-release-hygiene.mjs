import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowMissingLicense = process.argv.includes("--allow-missing-license");
const excludedDirectories = new Set([
  ".git",
  ".product-woc",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const scanExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const requiredFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "docs/known-limitations.md",
  "docs/release-policy.md",
  "examples/model-policy.example.json",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md",
];
if (!allowMissingLicense) requiredFiles.push("LICENSE");

const violations = [];
for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) violations.push(`${file}: required release file is missing`);
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    });
}

const forbiddenPatterns = [
  { name: "personal macOS path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: "personal Linux path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "personal Windows path", pattern: /[A-Za-z]:\\Users\\[^\\]+\\/ },
  { name: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "live API token", pattern: /\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{20,}\b/ },
];

for (const path of filesUnder(root)) {
  const relativePath = relative(root, path).replaceAll("\\", "/");
  if (
    !scanExtensions.has(extname(path)) ||
    relativePath.includes("/test/") ||
    relativePath.startsWith("scripts/")
  ) {
    continue;
  }
  const content = readFileSync(path, "utf8");
  for (const { name, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) violations.push(`${relativePath}: ${name}`);
  }
}

const workflowDirectory = join(root, ".github", "workflows");
if (existsSync(workflowDirectory)) {
  for (const workflow of filesUnder(workflowDirectory)) {
    const content = readFileSync(workflow, "utf8");
    if (/\b(?:deploy|publish|production[_ -]?write|git\s+push)\b/i.test(content)) {
      violations.push(`${relative(root, workflow)}: remote release or deployment action is forbidden`);
    }
    if (/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY)\b/.test(content)) {
      violations.push(`${relative(root, workflow)}: paid model credential is forbidden in CI`);
    }
  }
}

const examplePath = join(root, "examples", "model-policy.example.json");
if (existsSync(examplePath)) {
  const serialized = JSON.stringify(JSON.parse(readFileSync(examplePath, "utf8")));
  const credentialReferences = [...serialized.matchAll(/"credentialRef":"([^"]+)"/g)];
  if (credentialReferences.some(([, value]) => !value.startsWith("env:"))) {
    violations.push("examples/model-policy.example.json: credentials must be environment references");
  }
}

if (violations.length > 0) {
  process.stderr.write(`Release hygiene check failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Release hygiene check passed${allowMissingLicense ? " (license decision pending)" : ""}.\n`,
  );
}
