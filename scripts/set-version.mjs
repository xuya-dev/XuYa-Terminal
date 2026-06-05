import { readFileSync, writeFileSync } from "node:fs";

const versionInput = process.argv[2]?.trim();
const nextVersion = versionInput?.replace(/^v/i, "");
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!nextVersion || !semverPattern.test(nextVersion)) {
  console.error("Usage: pnpm run version:set -- <semver>");
  console.error("Example: pnpm run version:set -- 0.1.7");
  process.exit(1);
}

const localRustPackages = ["xuya-core", "xuya-pty", "xuya-terminal"];

updateJsonVersion("package.json");
updateJsonVersion("src-tauri/tauri.conf.json");

replaceInFile(
  "Cargo.toml",
  /(^version = ")[^"]+(")/m,
  `$1${nextVersion}$2`,
);

let cargoLock = readText("Cargo.lock");
for (const packageName of localRustPackages) {
  const packagePattern = new RegExp(
    `(\\[\\[package\\]\\]\\r?\\nname = "${escapeRegExp(
      packageName,
    )}"\\r?\\nversion = ")[^"]+(")`,
    "m",
  );
  if (!packagePattern.test(cargoLock)) {
    throw new Error(`No Cargo.lock package matched for ${packageName}`);
  }
  cargoLock = cargoLock.replace(packagePattern, `$1${nextVersion}$2`);
}
writeText("Cargo.lock", cargoLock);

replaceInFile("README.md", /当前版本：`[^`]+`/, `当前版本：\`${nextVersion}\``);
replaceInFile(
  "README.md",
  /pnpm run version:set -- [^\r\n]+/,
  `pnpm run version:set -- ${nextVersion}`,
);
replaceInFile("README.md", /git tag v[^\r\n]+/, `git tag v${nextVersion}`);
replaceInFile(
  "README.md",
  /git push origin v[^\r\n]+/,
  `git push origin v${nextVersion}`,
);

console.log(`Version set to ${nextVersion}`);

function updateJsonVersion(filePath) {
  JSON.parse(readText(filePath));
  replaceInFile(filePath, /("version"\s*:\s*")[^"]+(")/, `$1${nextVersion}$2`);
}

function replaceInFile(filePath, pattern, replacement) {
  const current = readText(filePath);
  if (!pattern.test(current)) {
    throw new Error(`No version field matched in ${filePath}`);
  }
  const next = current.replace(pattern, replacement);
  writeText(filePath, next);
}

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  writeFileSync(filePath, text, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
