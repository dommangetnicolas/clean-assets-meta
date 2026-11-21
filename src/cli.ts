#!/usr/bin/env node
/**
 * clean-assets-meta strip <file|folder>... [options]
 * clean-assets-meta apply <reference> <file|folder>... [options]
 * clean-assets-meta presets
 *
 * Removes metadata from images and videos, or copies it back from a reference file.
 * Requires exiftool (brew install exiftool).
 */

import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { apply, pairTargets } from "./apply.ts";
import { asFlags, COMMANDS, loadPresets, projectPresetsFile, resolveOptions, savePreset, userPresetsFile, type Command, type OptionSpec, type Preset, type Values } from "./presets.ts";
import { collectTargets, readTags, strip, summarize } from "./strip.ts";

const PRESET_HELP = `  -p, --preset <name>  use the options saved under this name (repeatable)
      --save-preset <name>
                       save these options under this name, for --preset
  -n, --dry-run`;

const STRIP_USAGE = `Usage: clean-assets-meta strip <file|folder>... [options]

Removes metadata from images (JPEG, PNG, HEIC, AVIF, TIFF, WebP, GIF) and videos
(MP4, MOV, M4V, 3GP), keeping the orientation and color profile so they look the
same. Files are replaced unless --out is given.

Options:
  -r, --recursive      also look in subfolders
  -o, --out <dir>      write cleaned copies here and leave the originals
      --all            also remove the orientation and color profile
      --gps-only       remove location data only
  -k, --keep <tag>     keep this tag too, e.g. --keep Copyright (repeatable)
      --keep-xattrs    leave macOS extended attributes (download source, Finder tags)
${PRESET_HELP}        list the files and their metadata, change nothing
  -h, --help           show this help

A flag given on the command line wins over a preset's; --no-<flag> turns off
one a preset turns on, e.g. --no-all.`;

const APPLY_USAGE = `Usage: clean-assets-meta apply <reference> <file|folder>... [options]

Copies the metadata of a reference file onto images or videos, e.g. to put back
what strip removed. Tags are added to what the file already has, in place.

  apply original.jpg clean.jpg        one reference, one or more files
  apply ./originals ./clean -r        folders: matched by relative path

Options:
  -r, --recursive      also look in subfolders
      --no-gps         leave out location data
  -x, --exclude <tag>  leave out this tag, e.g. -x Artist or -x XMP:all (repeatable)
${PRESET_HELP}        list which reference goes to which file, change nothing
  -h, --help           show this help

A flag given on the command line wins over a preset's; --no-<flag> turns off
one a preset turns on, e.g. --no-recursive.`;

const PRESETS_USAGE = `Usage: clean-assets-meta presets

Lists the presets you can use with --preset <name>. Save one with
--save-preset <name> on strip or apply, or write them by hand in either file:

  ${userPresetsFile()}
      yours
  ./.clean-assets-meta.json (here or in a parent folder)
      the project's, to share with others; wins when both have the same name

  { "presets": { "web": { "strip": { "all": true, "keep": ["Copyright"] } } } }`;

const USAGE = `Usage: clean-assets-meta <command> [options]

Commands:
  strip <file|folder>...               remove metadata from images and videos
  apply <reference> <file|folder>...   copy metadata from a reference file
  presets                              list saved presets

Run clean-assets-meta <command> --help for its options.`;

function fail(message: string): never {
  console.error(`clean-assets-meta: ${message}`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "-h" || command === "--help") {
  console.log(USAGE);
  process.exit(0);
}
// Short paths under the current folder, full ones elsewhere
const rel = (f: string) => {
  const r = path.relative(process.cwd(), f);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? r : f;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const home = (f: string) => (f.startsWith(os.homedir() + path.sep) ? "~" + f.slice(os.homedir().length) : rel(f));

// No defaults here: an option left out must not override a preset's
const STRIP_OPTIONS = {
  recursive: { type: "boolean", short: "r" },
  out: { type: "string", short: "o" },
  all: { type: "boolean" },
  "gps-only": { type: "boolean" },
  keep: { type: "string", short: "k", multiple: true },
  "keep-xattrs": { type: "boolean" },
} as const satisfies OptionSpec;
const APPLY_OPTIONS = {
  recursive: { type: "boolean", short: "r" },
  gps: { type: "boolean" }, // on unless --no-gps
  exclude: { type: "string", short: "x", multiple: true },
} as const satisfies OptionSpec;
const COMMON_OPTIONS = {
  preset: { type: "string", short: "p", multiple: true },
  "save-preset": { type: "string" },
  "dry-run": { type: "boolean", short: "n" },
  help: { type: "boolean", short: "h" },
} as const satisfies OptionSpec;

/**
 * Parses a command's arguments and merges in its presets. With --save-preset,
 * saves the result, and stops there when no files were given.
 */
function parse(command: Command, args: string[], spec: OptionSpec, usage: string) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, allowNegative: true, options: { ...spec, ...COMMON_OPTIONS } });
  } catch (e) {
    fail((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }
  for (const key of ["preset", "save-preset", "dry-run", "help"] as const) {
    if (values[key] === false) fail(`--no-${key} isn't an option`);
  }
  const given = Object.fromEntries(Object.keys(spec).map((k) => [k, (values as Values)[k]]));
  const names = (values.preset as string[] | undefined) ?? [];
  const save = values["save-preset"] as string | undefined;
  try {
    const presets = names.length ? loadPresets() : new Map<string, Preset>();
    const options = resolveOptions(command, given, names, spec, presets);
    if (save !== undefined) {
      if (!/^[\w.-]+$/.test(save)) fail(`preset names can only have letters, digits, ".", "_" and "-": ${save}`);
      const file = userPresetsFile();
      savePreset(file, save, command, options);
      console.log(`saved preset "${save}" for ${command}: ${asFlags(options) || "(no options)"} (in ${home(file)})`);
      if (!positionals.length) process.exit(0);
    }
    return { options, positionals, dryRun: values["dry-run"] === true };
  } catch (e) {
    fail((e as Error).message);
  }
}

if (command === "strip") await stripCommand(rest);
else if (command === "apply") await applyCommand(rest);
else if (command === "presets") presetsCommand(rest);
else fail(`unknown command "${command}"\n\n${USAGE}`);

async function stripCommand(args: string[]) {
  const { options, positionals, dryRun } = parse("strip", args, STRIP_OPTIONS, STRIP_USAGE);
  const values = options as { recursive?: boolean; out?: string; all?: boolean; "gps-only"?: boolean; keep?: string[]; "keep-xattrs"?: boolean };
  const keep = values.keep ?? [];
  if (!positionals.length) fail(`no files or folders given\n\n${STRIP_USAGE}`);
  if (values.all && values["gps-only"]) fail("--all and --gps-only can't be used together");
  if (values["gps-only"] && keep.length) fail("--keep has no effect with --gps-only");

  const opts = { all: values.all, gpsOnly: values["gps-only"], keep, keepXattrs: values["keep-xattrs"] };
  try {
    const targets = collectTargets(positionals, { recursive: values.recursive, outDir: values.out });
    if (!targets.length) fail("no images or videos found" + (values.recursive ? "" : " (use -r to look in subfolders)"));

    if (dryRun) {
      const tags = await readTags(targets.map((t) => t.src));
      for (const t of targets) {
        const s = summarize(tags.get(t.src) ?? {});
        const dest = t.dest === t.src ? "" : ` → ${rel(t.dest)}`;
        const notes = [s.gps && "has location", s.icc && "color profile"].filter(Boolean).join(", ");
        console.log(`${rel(t.src)}${dest}: ${plural(s.tags, "metadata tag")}${notes ? ` (${notes})` : ""}`);
      }
      console.log(`\n${plural(targets.length, "file")}, nothing changed (dry run)`);
    } else {
      const { cleaned, failed } = await strip(targets, opts);
      for (const f of failed) console.error(`failed: ${rel(f.file)}: ${f.error}`);
      console.log(`cleaned ${plural(cleaned.length, "file")}${failed.length ? `, ${failed.length} failed` : ""}`);
      if (failed.length) process.exit(1);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

async function applyCommand(args: string[]) {
  const { options, positionals, dryRun } = parse("apply", args, APPLY_OPTIONS, APPLY_USAGE);
  const values = options as { recursive?: boolean; gps?: boolean; exclude?: string[] };
  const [reference, ...targets] = positionals;
  if (!targets.length) fail(`give a reference file and the files to apply it to\n\n${APPLY_USAGE}`);

  try {
    const { pairs, unmatched } = pairTargets(reference, targets, { recursive: values.recursive });
    for (const f of unmatched) console.error(`skipped: ${rel(f)}: no file at the same path in ${rel(path.resolve(reference))}`);
    if (!pairs.length) fail("no images or videos found" + (values.recursive ? "" : " (use -r to look in subfolders)"));

    if (dryRun) {
      for (const p of pairs) console.log(`${rel(p.ref)} → ${rel(p.dest)}`);
      console.log(`\n${plural(pairs.length, "file")}, nothing changed (dry run)`);
    } else {
      const { applied, failed } = await apply(pairs, { noGps: values.gps === false, exclude: values.exclude });
      for (const f of failed) console.error(`failed: ${rel(f.file)}: ${f.error}`);
      const notes = [failed.length && `${failed.length} failed`, unmatched.length && `${unmatched.length} skipped`].filter(Boolean);
      console.log(`applied metadata to ${plural(applied.length, "file")}${notes.length ? `, ${notes.join(", ")}` : ""}`);
      if (failed.length || unmatched.length) process.exit(1);
    }
  } catch (e) {
    fail((e as Error).message);
  }
}

function presetsCommand(args: string[]) {
  if (args.includes("-h") || args.includes("--help")) {
    console.log(PRESETS_USAGE);
    process.exit(0);
  }
  if (args.length) fail(`presets takes no arguments\n\n${PRESETS_USAGE}`);
  let presets;
  try {
    presets = loadPresets();
  } catch (e) {
    fail((e as Error).message);
  }
  if (!presets.size) {
    const project = projectPresetsFile();
    console.log(`no presets yet (looked in ${home(userPresetsFile())}${project ? ` and ${home(project)}` : ""})`);
    console.log("save one with --save-preset <name>, e.g.: clean-assets-meta strip --all -k Copyright --save-preset web");
    return;
  }
  for (const p of [...presets.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${p.name}  (${home(p.file)})`);
    for (const c of COMMANDS) if (p.commands[c]) console.log(`  ${c}: ${asFlags(p.commands[c]) || "(no options)"}`);
  }
}
