import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";

const files = execFileSync("git", ["ls-files", "--cached", "--deduplicate", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && lstatSync(file, { throwIfNoEntry: false })?.isFile())
  .map((file) => `./${file}`);

if (files.length > 0) {
  const prettier = fileURLToPath(import.meta.resolve("prettier/bin/prettier.cjs"));
  const result = spawnSync(process.execPath, [prettier, process.argv[2], "--ignore-unknown", "--", ...files], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
