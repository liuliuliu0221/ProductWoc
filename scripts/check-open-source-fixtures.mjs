import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(root, "fixtures");

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...filesUnder(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

const forbiddenPatterns = [
  { name: "macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { name: "Linux user path", pattern: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "Windows user path", pattern: /[A-Za-z]:\\Users\\[^\\]+\\/ },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "live API token", pattern: /\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{20,}\b/ },
];

const violations = [];
for (const fixture of filesUnder(fixtureRoot)) {
  const content = readFileSync(fixture, "utf8");
  for (const { name, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) {
      violations.push(`${relative(root, fixture)}: ${name}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Open-source fixture check failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Open-source fixture check passed: no personal path or credential pattern found.\n",
  );
}
