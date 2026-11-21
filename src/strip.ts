/**
 * Removes metadata from images and MP4/MOV videos with exiftool (brew install exiftool).
 *
 * By default everything goes except what's needed to display the image the same
 * way: the orientation and the ICC color profile. `all` removes those too;
 * `gpsOnly` removes only location data. A video's rotation and color information
 * are part of its tracks and always stay, and its header dates are set to zero. macOS extended attributes (download
 * source, quarantine, Finder tags) are cleared as well unless `keepXattrs`;
 * com.apple.provenance stays, as macOS protects it and doesn't let it be removed.
 */

import fs from "node:fs";
import path from "node:path";
import { exiftool, isMedia, parseErrors, requireExiftool, run } from "./exiftool.ts";

export { EXTENSIONS, isMedia } from "./exiftool.ts";

export type StripOptions = {
  all?: boolean;
  gpsOnly?: boolean;
  keep?: string[];
  keepXattrs?: boolean;
};

/** A file to clean and where the cleaned file goes (the same path when in place). */
export type Target = { src: string; dest: string };

// A video's creation and modification dates sit in its movie and track headers,
// which -all= leaves alone; they can't be removed, only set to zero. Images have
// no such tags, so these do nothing to them.
const VIDEO_DATES = ["-QuickTime:CreateDate=", "-QuickTime:ModifyDate=", "-Track*Date=", "-Media*Date="];

/** The exiftool arguments that remove metadata for these options. */
export function stripArgs(opts: StripOptions = {}): string[] {
  if (opts.gpsOnly) {
    if (opts.all || opts.keep?.length) throw new Error("--gps-only can't be combined with --all or --keep");
    // The EXIF GPS block, GPS tags stored elsewhere (XMP exif:GPS…, video keys),
    // and the place name and accuracy Apple stores next to a video's coordinates
    return ["-gps:all=", "-GPS*=", "-QuickTime:Location*="];
  }
  const keep = [...(opts.all ? [] : ["Orientation", "ICC_Profile"]), ...(opts.keep ?? [])];
  return ["-all=", ...VIDEO_DATES, ...(keep.length ? ["-tagsFromFile", "@", ...keep.map((t) => `-${t}`)] : [])];
}

/** The images in a folder, in subfolders too with `recursive`. */
export function listMedia(dir: string, recursive = false): string[] {
  const files: string[] = [];
  for (const e of fs.readdirSync(dir, { recursive, withFileTypes: true })) {
    // ._name files are macOS resource forks on non-Apple disks, not images
    if (e.isFile() && isMedia(e.name) && !e.name.startsWith("._")) files.push(path.join(e.parentPath, e.name));
  }
  return files;
}

/**
 * The images to clean: files given directly (any supported extension) and the
 * images in folders given, in subfolders too with `recursive`. With `outDir`,
 * each copy keeps its path relative to the folder it was found in.
 */
export function collectTargets(inputs: string[], { recursive = false, outDir }: { recursive?: boolean; outDir?: string } = {}): Target[] {
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (src: string, rel: string) => {
    const abs = path.resolve(src);
    if (seen.has(abs)) return;
    seen.add(abs);
    targets.push({ src: abs, dest: outDir ? path.resolve(outDir, rel) : abs });
  };

  for (const input of inputs) {
    const stat = fs.statSync(input, { throwIfNoEntry: false });
    if (!stat) throw new Error(`not found: ${input}`);
    if (stat.isFile()) {
      if (!isMedia(input)) throw new Error(`not a supported image or video: ${input}`);
      add(input, path.basename(input));
    } else if (stat.isDirectory()) {
      for (const file of listMedia(input, recursive)) add(file, path.relative(input, file));
    }
  }

  const dests = new Set<string>();
  for (const t of targets) {
    if (dests.has(t.dest)) throw new Error(`two files would be written to ${t.dest}`);
    dests.add(t.dest);
  }
  return targets;
}

// File system details exiftool reports, not metadata stored in the image
const NOT_METADATA = new Set(["ExifTool", "System", "File", "Composite"]);

/** The metadata tags in each file, as "Group:Tag" → value, by absolute path. */
export async function readTags(files: string[]): Promise<Map<string, Record<string, unknown>>> {
  const tags = new Map<string, Record<string, unknown>>();
  if (!files.length) return tags;
  const { stdout } = await exiftool(["-j", "-a", "-G1", "-s", "-n"], files);
  for (const entry of JSON.parse(stdout || "[]") as Record<string, unknown>[]) {
    const own: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      const group = key.split(":")[0];
      if (key !== "SourceFile" && key.includes(":") && !NOT_METADATA.has(group)) own[key] = value;
    }
    tags.set(path.resolve(String(entry.SourceFile)), own);
  }
  return tags;
}

// Image structure exiftool lists as tags, which no strip removes: the PNG header,
// the JPEG's JFIF segment, HEIC/AVIF codec setup (QuickTime, Meta), a video's
// movie and track headers (QuickTime, Track1, Track2…), and YCbCrPositioning,
// which exiftool adds to any EXIF block it writes
const PNG_HEADER = new Set(["ImageWidth", "ImageHeight", "BitDepth", "ColorType", "Compression", "Filter", "Interlace"]);
const STRUCTURE_GROUPS = new Set(["JFIF", "QuickTime", "Meta"]);
const isStructureGroup = (group: string) => STRUCTURE_GROUPS.has(group) || /^Track\d+$/.test(group);
// The header dates are the exception: strip sets them to zero, and any other value is metadata
const isZeroDate = (value: unknown) => typeof value === "string" && /^[0:\s]+$/.test(value);

/** How much metadata a file carries: tags beyond the file's structure, location, color profile. */
export function summarize(tags: Record<string, unknown>) {
  const keys = Object.keys(tags);
  const isIcc = (k: string) => k.startsWith("ICC");
  const metadata = keys.filter((k) => {
    const [group, name] = k.split(":");
    if (isStructureGroup(group)) return name.endsWith("Date") && !isZeroDate(tags[k]);
    return !isIcc(k) && name !== "YCbCrPositioning" && !(group === "PNG" && PNG_HEADER.has(name));
  });
  return { tags: metadata.length, gps: metadata.some((k) => /GPS/i.test(k)), icc: keys.some(isIcc) };
}

export type StripResult = { cleaned: string[]; failed: { file: string; error: string }[] };

/**
 * Cleans the targets. In place, the original is replaced; with a different
 * dest, the file is copied there first (an existing file there is an error).
 */
export async function strip(targets: Target[], opts: StripOptions = {}): Promise<StripResult> {
  await requireExiftool();
  const args = stripArgs(opts);
  const failed: StripResult["failed"] = [];

  const ready: string[] = [];
  for (const { src, dest } of targets) {
    if (src === dest) { ready.push(dest); continue; }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      ready.push(dest);
    } catch (e) {
      failed.push({ file: src, error: (e as NodeJS.ErrnoException).code === "EEXIST" ? `already exists: ${dest}` : String(e) });
    }
  }

  // -overwrite_original swaps in a new file, which drops extended attributes; writing in place keeps them
  const overwrite = opts.keepXattrs ? "-overwrite_original_in_place" : "-overwrite_original";
  const { stderr } = ready.length ? await exiftool([overwrite, "-m", ...args], ready) : { stderr: "" };
  const errors = parseErrors(stderr);

  const cleaned: string[] = [];
  for (const file of ready) {
    const error = errors.get(file);
    if (error) { failed.push({ file, error }); continue; }
    if (!opts.keepXattrs && process.platform === "darwin") await run("xattr", ["-c", file]).catch(() => {});
    cleaned.push(file);
  }
  return { cleaned, failed };
}
