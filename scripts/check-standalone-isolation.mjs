import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageFiles = ["package.json"];
for (const group of ["apps", "packages"]) {
  for (const entry of readdirSync(join(root, group))) {
    packageFiles.push(join(group, entry, "package.json"));
  }
}

const violations = [];
for (const packageFile of packageFiles) {
  const manifest = JSON.parse(readFileSync(join(root, packageFile), "utf8"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (
        name.startsWith("@product-factory/") ||
        /(?:^|[/\\])ProductFac(?:[/\\]|$)/i.test(String(specifier))
      ) {
        violations.push(`${packageFile}: ${field}.${name}=${specifier}`);
      }
    }
  }
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (!['dist', 'node_modules', '.turbo'].includes(entry)) {
        files.push(...sourceFiles(path));
      }
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

for (const group of ["apps", "packages"]) {
  for (const sourceFile of sourceFiles(join(root, group))) {
    const source = readFileSync(sourceFile, "utf8");
    if (
      /(?:from|import\s*)\s*[('"`]@product-factory\//.test(source) ||
      /(?:from|import\s*)\s*[('"`][^'"`]*[/\\]ProductFac[/\\]/i.test(source)
    ) {
      violations.push(`${relative(root, sourceFile)}: ProductFac runtime import`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Standalone isolation check failed:\n${violations.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Standalone isolation check passed: no ProductFac runtime dependency or source import.\n",
  );
}
