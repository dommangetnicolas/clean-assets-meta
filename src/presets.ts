/**
 * Named sets of options, reused with --preset <name>.
 *
 * Presets are read from the user's file (~/.config/clean-assets-meta/presets.json,
 * or under $XDG_CONFIG_HOME) and from a project file (.clean-assets-meta.json in
 * the current folder or the closest parent that has one), which wins when both
 * define the same name. Each preset has options per command, named like the
 * long flags:
 *
 *   { "presets": { "web": { "strip": { "all": true, "keep": ["Copyright"] },
 *                           "apply": { "no-gps": true } } } }
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COMMANDS = ["strip", "apply"] as const;
export type Command = (typeof COMMANDS)[number];

/** A command's options, as parseArgs takes them. */
export type OptionSpec = Record<string, { type: "boolean" | "string"; multiple?: boolean; short?: string }>;
export type Values = Record<string, boolean | string | string[] | undefined>;
export type Preset = { name: string; file: string; commands: Partial<Record<Command, Values>> };

export const PROJECT_FILE = ".clean-assets-meta.json";

export function userPresetsFile(env = process.env): string {
  const config = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(config, "clean-assets-meta", "presets.json");
}

/** The closest project file from `cwd` up, if any. */
export function projectPresetsFile(cwd = process.cwd()): string | undefined {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const file = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(file)) return file;
    if (path.dirname(dir) === dir) return undefined;
  }
}

function readFile(file: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`can't read presets from ${file}: ${(e as Error).message}`);
  }
  const presets = (data as { presets?: unknown })?.presets ?? {};
  if (typeof presets !== "object" || Array.isArray(presets)) throw new Error(`${file}: "presets" should be an object`);
  return presets as Record<string, unknown>;
}

/** Every preset by name, with the project file's taking precedence over the user's. */
export function loadPresets({ cwd = process.cwd(), userFile = userPresetsFile() } = {}): Map<string, Preset> {
  const presets = new Map<string, Preset>();
  for (const file of [userFile, projectPresetsFile(cwd)]) {
    if (!file) continue;
    for (const [name, value] of Object.entries(readFile(file))) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}: preset "${name}" should be an object`);
      const commands: Preset["commands"] = {};
      for (const [command, options] of Object.entries(value)) {
        if (!(COMMANDS as readonly string[]).includes(command)) throw new Error(`${file}: preset "${name}" has unknown command "${command}" (expected ${COMMANDS.join(" or ")})`);
        commands[command as Command] = options as Values;
      }
      presets.set(name, { name, file, commands });
    }
  }
  return presets;
}

/** Checks a preset's options against the command's, so a typo doesn't go unnoticed. */
export function checkValues(values: unknown, spec: OptionSpec, where: string): Values {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`${where} should be an object`);
  for (const [key, value] of Object.entries(values)) {
    const opt = spec[key];
    if (!opt) throw new Error(`${where} has unknown option "${key}" (expected one of: ${Object.keys(spec).join(", ")})`);
    const ok = opt.multiple
      ? Array.isArray(value) && value.every((v) => typeof v === "string") || typeof value === "string"
      : typeof value === opt.type;
    if (!ok) throw new Error(`${where}: "${key}" should be ${opt.multiple ? "a list of strings" : `a ${opt.type}`}`);
  }
  return values as Values;
}

/**
 * The options to run with: the presets' in order, then the ones given on the
 * command line. Later values replace earlier ones; lists (like --keep) add up.
 */
export function resolveOptions(command: Command, given: Values, names: string[], spec: OptionSpec, presets: Map<string, Preset>): Values {
  const result: Values = {};
  const merge = (values: Values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (spec[key]?.multiple) result[key] = [...((result[key] as string[]) ?? []), ...[value as string | string[]].flat()];
      else result[key] = value;
    }
  };
  for (const name of names) {
    const preset = presets.get(name);
    if (!preset) {
      const known = [...presets.keys()];
      throw new Error(`no preset named "${name}"${known.length ? ` (have: ${known.join(", ")})` : ""}`);
    }
    const values = preset.commands[command];
    if (!values) throw new Error(`preset "${name}" has no options for ${command} (in ${preset.file})`);
    merge(checkValues(values, spec, `preset "${name}" for ${command} (in ${preset.file})`));
  }
  merge(given);
  return result;
}

/** Saves `values` as the preset's options for `command`, keeping its other commands and the file's other presets. */
export function savePreset(file: string, name: string, command: Command, values: Values): void {
  let data: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    readFile(file); // fails on a malformed file rather than overwriting it
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  }
  const presets = (data.presets ??= {}) as Record<string, Record<string, Values>>;
  const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
  presets[name] = { ...presets[name], [command]: clean };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** A preset's options written as command-line flags, for listing. */
export function asFlags(values: Values): string {
  const quote = (v: string) => (/^[\w./:@%+=,-]+$/.test(v) ? v : `'${v.replace(/'/g, `'\\''`)}'`);
  return Object.entries(values)
    .flatMap(([key, value]) =>
      value === true ? [`--${key}`] : value === false ? [`--no-${key}`] : value === undefined ? [] : [value].flat().map((v) => `--${key} ${quote(v)}`))
    .join(" ");
}
