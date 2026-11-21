import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const CLI = path.join(import.meta.dirname, "cli.ts");

test("--version prints the package version", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"));
  for (const flag of ["--version", "-v"]) {
    assert.equal(execFileSync(process.execPath, [CLI, flag], { encoding: "utf8" }).trim(), version);
  }
});
