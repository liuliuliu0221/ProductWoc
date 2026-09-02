import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = join(root, "packages");

const developmentPackages = [
  "development-contracts",
  "development-domain",
  "development-agent",
  "development-adapters",
  "development-workflow",
  "development-evals",
];

const forbiddenWorkspaceDependencies = {
  "development-contracts": developmentPackages.filter(
    (name) => name !== "development-contracts",
  ),
  "development-domain": [
    "development-agent",
    "development-adapters",
    "development-workflow",
    "development-evals",
  ],
  "development-agent": [
    "development-adapters",
    "development-workflow",
    "development-evals",
  ],
  "development-adapters": [
    "development-agent",
    "development-workflow",
    "development-evals",
  ],
  "development-workflow": ["development-evals"],
  "development-evals": [],
};

const violations = [];

function walkSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (!["dist", "node_modules", ".turbo"].includes(entry)) {
        files.push(...walkSourceFiles(path));
      }
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

for (const packageName of developmentPackages) {
  const directory = join(packageRoot, packageName);
  const manifestPath = join(directory, "package.json");
  const sourceDirectory = join(directory, "src");

  if (!existsSync(manifestPath) || !existsSync(sourceDirectory)) {
    violations.push(`${packageName}: missing package manifest or src directory`);
    continue;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };

  for (const forbiddenName of forbiddenWorkspaceDependencies[packageName]) {
    const dependencyName = `@product-woc/${forbiddenName}`;
    if (dependencyName in dependencies) {
      violations.push(`${packageName}: forbidden dependency ${dependencyName}`);
    }
  }

  for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
    if (/deploy|production[:_-]?write/i.test(`${scriptName} ${command}`)) {
      violations.push(`${packageName}: deployment-capable script ${scriptName}`);
    }
  }
}

const domainSourceDirectory = join(packageRoot, "development-domain", "src");
if (existsSync(domainSourceDirectory)) {
  const forbiddenDomainImports = [
    /["']node:(?:fs|fs\/promises|child_process)["']/,
    /["'](?:execa|simple-git|openai|ollama|@anthropic-ai\/sdk)["']/,
  ];
  for (const sourceFile of walkSourceFiles(domainSourceDirectory)) {
    const source = readFileSync(sourceFile, "utf8");
    if (forbiddenDomainImports.some((pattern) => pattern.test(source))) {
      violations.push(
        `${relative(root, sourceFile)}: infrastructure import in development-domain`,
      );
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Package boundary check failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Package boundary check passed: P3 packages follow the standalone dependency direction.\n",
  );
}
