import fs from "node:fs";
import path from "node:path";

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm run version:set -- <semver>");
  process.exit(1);
}

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content);
}

function updateJson(file, updater) {
  const data = JSON.parse(read(file));
  updater(data);
  write(file, `${JSON.stringify(data, null, 2)}\n`);
}

function replace(file, pattern, replacement) {
  const before = read(file);
  if (!pattern.test(before)) {
    throw new Error(`No version match found in ${file}`);
  }
  const after = before.replace(pattern, replacement);
  write(file, after);
}

updateJson("package.json", (data) => {
  data.version = version;
});

updateJson("src-tauri/tauri.conf.json", (data) => {
  data.version = version;
});

replace("Cargo.toml", /^version = ".+"/m, `version = "${version}"`);
replace("src-tauri/Cargo.toml", /^version = ".+"/m, `version = "${version}"`);
replace(
  "Cargo.lock",
  /(name = "xuya-terminal"\r?\nversion = )"[^"]+"/,
  `$1"${version}"`,
);

if (fs.existsSync(path.join(root, "src-tauri/Cargo.lock"))) {
  const before = read("src-tauri/Cargo.lock");
  const after = before.replace(
    /(name = "xuya-terminal"\r?\nversion = )"[^"]+"/,
    `$1"${version}"`,
  );
  if (after !== before) write("src-tauri/Cargo.lock", after);
}

let readme = read("README.md");
readme = readme
  .replace(/当前版本：`[^`]+`/, `当前版本：\`${version}\``)
  .replace(/pnpm run version:set -- [^\r\n]+/, `pnpm run version:set -- ${version}`)
  .replace(/git tag v[^\r\n]+/, `git tag v${version}`)
  .replace(/git push origin v[^\r\n]+/, `git push origin v${version}`);
write("README.md", readme);

console.log(`Version set to ${version}`);
