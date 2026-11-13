#!/usr/bin/env node
/**
 * clean-assets-meta strip <file|folder>... [options]
 *
 * Removes metadata from images. Requires exiftool (brew install exiftool).
 */

import path from "node:path";
import { parseArgs } from "node:util";
import { collectTargets, readTags, strip, summarize } from "./strip.ts";

const USAGE = `Usage: clean-assets-meta strip <file|folder>... [options]

Removes metadata from images (JPEG, PNG, HEIC, AVIF, TIFF, WebP, GIF), keeping
the orientation and color profile so they look the same. Files are replaced
unless --out is given.

Options:
  -r, --recursive      also look in subfolders
  -o, --out <dir>      write cleaned copies here and leave the originals
      --all            also remove the orientation and color profile
      --gps-only       remove location data only
  -k, --keep <tag>     keep this tag too, e.g. --keep Copyright (repeatable)
      --keep-xattrs    leave macOS extended attributes (download source, Finder tags)
  -n, --dry-run        list the files and their metadata, change nothing
  -h, --help           show this help`;

function fail(message: string): never {
  console.error(`clean-assets-meta: ${message}`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "-h" || command === "--help") {
  console.log(USAGE);
  process.exit(0);
}
if (command !== "strip") fail(`unknown command "${command}"\n\n${USAGE}`);

let parsed;
try {
  parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      recursive: { type: "boolean", short: "r", default: false },
      out: { type: "string", short: "o" },
      all: { type: "boolean", default: false },
      "gps-only": { type: "boolean", default: false },
      keep: { type: "string", short: "k", multiple: true, default: [] },
      "keep-xattrs": { type: "boolean", default: false },
      "dry-run": { type: "boolean", short: "n", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  fail((e as Error).message);
}
const { values, positionals } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!positionals.length) fail(`no files or folders given\n\n${USAGE}`);
if (values.all && values["gps-only"]) fail("--all and --gps-only can't be used together");
if (values["gps-only"] && values.keep.length) fail("--keep has no effect with --gps-only");

const opts = { all: values.all, gpsOnly: values["gps-only"], keep: values.keep, keepXattrs: values["keep-xattrs"] };
// Short paths under the current folder, full ones elsewhere
const rel = (f: string) => {
  const r = path.relative(process.cwd(), f);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : f;
};

try {
  const targets = collectTargets(positionals, { recursive: values.recursive, outDir: values.out });
  if (!targets.length) fail("no images found" + (values.recursive ? "" : " (use -r to look in subfolders)"));

  if (values["dry-run"]) {
    const tags = await readTags(targets.map((t) => t.src));
    for (const t of targets) {
      const s = summarize(tags.get(t.src) ?? {});
      const dest = t.dest === t.src ? "" : ` → ${rel(t.dest)}`;
      const notes = [s.gps && "has location", s.icc && "color profile"].filter(Boolean).join(", ");
      console.log(`${rel(t.src)}${dest}: ${s.tags} metadata tag${s.tags === 1 ? "" : "s"}${notes ? ` (${notes})` : ""}`);
    }
    console.log(`\n${targets.length} image${targets.length === 1 ? "" : "s"}, nothing changed (dry run)`);
  } else {
    const { cleaned, failed } = await strip(targets, opts);
    for (const f of failed) console.error(`failed: ${rel(f.file)}: ${f.error}`);
    console.log(`cleaned ${cleaned.length} image${cleaned.length === 1 ? "" : "s"}${failed.length ? `, ${failed.length} failed` : ""}`);
    if (failed.length) process.exit(1);
  }
} catch (e) {
  fail((e as Error).message);
}
