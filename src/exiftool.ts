/** Running exiftool (brew install exiftool). */

import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const run = promisify(execFile);

export const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".avif", ".tif", ".tiff", ".webp", ".gif"]);
export const isImage = (file: string) => EXTENSIONS.has(path.extname(file).toLowerCase());

let version: Promise<string | null> | null = null;
/** exiftool's version, or null when it isn't installed. */
export const exiftoolVersion = () =>
  (version ??= run("exiftool", ["-ver"]).then(({ stdout }) => stdout.trim(), () => null));

export async function requireExiftool() {
  if (!(await exiftoolVersion())) throw new Error("exiftool not found (brew install exiftool)");
}

/**
 * Runs exiftool with `args` on the command line and `lines` (file names, or more
 * arguments, one per line) through stdin, so a large folder doesn't hit the
 * argument length limit. exiftool exits 1 when some files fail and still handles
 * the others, so the exit code is returned, not thrown.
 */
export function exiftool(args: string[], lines: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn("exiftool", ["-charset", "filename=utf8", "-@", "-", ...args]);
    let stdout = "", stderr = "";
    p.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    p.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    p.stdin.end(lines.join("\n") + "\n");
  });
}

/** exiftool's error lines ("Error: <message> - <file>") as absolute path → message. */
export function parseErrors(stderr: string): Map<string, string> {
  const errors = new Map<string, string>();
  for (const line of stderr.split("\n")) {
    const m = line.match(/^Error: (.*) - (.+)$/);
    if (m) errors.set(path.resolve(m[2]), m[1]);
  }
  return errors;
}
