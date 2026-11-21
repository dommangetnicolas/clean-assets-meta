/**
 * Copies metadata from a reference image or video onto another one with exiftool, e.g. to
 * put back the metadata of an original on a copy that was stripped or exported
 * without it.
 *
 * Tags go to the same places they have in the reference (EXIF, XMP, IPTC…) and
 * are added to what the target already has, replacing tags of the same name.
 * The orientation and color profile are the exception: they describe the
 * target's pixels, which may have been rotated or converted since, so they are
 * only copied when the target has none. The orientation also needs the target
 * to have the reference's pixel size: an export without one is usually already
 * upright (often resized too), and rotating it again would turn it sideways.
 * A video's rotation is never copied: it is part of the video track, and every
 * video has one, so there is no telling whether an export was already turned.
 * A reference folder is matched to a target folder by relative path.
 */

import fs from "node:fs";
import path from "node:path";
import { exiftool, isMedia, requireExiftool } from "./exiftool.ts";
import { listMedia } from "./strip.ts";

export type ApplyOptions = {
  /** Leave out location data. */
  noGps?: boolean;
  /** Leave out these tags (exiftool names, e.g. Artist or XMP:all). */
  exclude?: string[];
};

/** A file to write metadata to, and the file to take it from. */
export type Pair = { ref: string; dest: string };

/** An image's stored pixel size, before any orientation is applied. */
export type Size = { width: number; height: number };

const VIDEO_FILE_TYPE = ["MajorBrand", "MinorVersion", "CompatibleBrands"];

/**
 * The exiftool commands (run one after another on the target) that copy metadata
 * from `ref`: everything but the orientation, then the orientation if the target
 * has none and is `refSize` (the reference's pixel size; without it the
 * orientation is never copied), and the color profile if the target has none.
 */
export function applyArgs(ref: string, opts: ApplyOptions = {}, refSize?: Size): string[][] {
  const exclude = [...(opts.noGps ? ["gps:all", "GPS*"] : []), ...(opts.exclude ?? [])];
  const excluded = (tag: string) => exclude.some((t) => t.toLowerCase().split(":").pop() === tag.toLowerCase());
  const from = ["-tagsFromFile", ref];
  return [
    // A video's file type (MajorBrand…) is listed as tags but isn't metadata:
    // exiftool would copy it into the target's metadata keys
    [...from, "-all:all", "--Orientation", ...VIDEO_FILE_TYPE.map((t) => `--${t}`), ...exclude.map((t) => `--${t}`)],
    ...(excluded("Orientation") || !refSize ? [] : [[
      "-if", `not $Orientation and $ImageWidth# == ${refSize.width} and $ImageHeight# == ${refSize.height}`,
      ...from, "-Orientation",
    ]]),
    // -wm doesn't apply to the ICC profile, which is written as one block, and
    // -tagsFromFile with -all:all leaves it out as an "unsafe" tag
    ...(excluded("ICC_Profile") ? [] : [["-if", "not $ICC_Profile:all", ...from, "-ICC_Profile"]]),
  ];
}

/**
 * Pairs each target image with its reference. With a reference file, every
 * target (files, and images in folders given) gets its metadata. With a
 * reference folder, the one target must be a folder too, and each image in it is
 * paired with the file at the same relative path in the reference folder; those
 * without one are returned in `unmatched`.
 */
export function pairTargets(reference: string, targets: string[], { recursive = false } = {}): { pairs: Pair[]; unmatched: string[] } {
  const refStat = fs.statSync(reference, { throwIfNoEntry: false });
  if (!refStat) throw new Error(`not found: ${reference}`);
  const stats = targets.map((t) => {
    const stat = fs.statSync(t, { throwIfNoEntry: false });
    if (!stat) throw new Error(`not found: ${t}`);
    return stat;
  });
  const ref = path.resolve(reference);
  const pairs: Pair[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  const add = (refFile: string, dest: string) => {
    const abs = path.resolve(dest);
    if (abs === refFile) throw new Error(`${dest} is the reference itself`);
    if (!seen.has(abs)) pairs.push({ ref: refFile, dest: abs });
    seen.add(abs);
  };

  if (refStat.isDirectory()) {
    if (targets.length !== 1 || !stats[0].isDirectory()) throw new Error("a reference folder needs one target folder");
    const dir = path.resolve(targets[0]);
    if (dir === ref) throw new Error("the reference and target folders are the same");
    for (const file of listMedia(dir, recursive)) {
      const refFile = path.join(ref, path.relative(dir, file));
      if (fs.statSync(refFile, { throwIfNoEntry: false })?.isFile()) add(refFile, file);
      else unmatched.push(file);
    }
  } else {
    targets.forEach((t, i) => {
      if (stats[i].isDirectory()) for (const file of listMedia(t, recursive)) add(ref, file);
      else if (!isMedia(t)) throw new Error(`not a supported image or video: ${t}`);
      else add(ref, t);
    });
  }
  return { pairs, unmatched };
}

export type ApplyResult = { applied: string[]; failed: { file: string; error: string }[] };

/** Copies the metadata of each pair's reference onto its target, in place. */
export async function apply(pairs: Pair[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  await requireExiftool();
  if (!pairs.length) return { applied: [], failed: [] };
  const sizes = await readSizes([...new Set(pairs.map((p) => p.ref))]);

  // One exiftool run with an -execute block per command. Each block first prints
  // a marker on stderr so the messages that follow can be tied to its file.
  const lines = pairs.flatMap(({ ref, dest }, i) =>
    applyArgs(ref, opts, sizes.get(path.resolve(ref))).flatMap((args, step) => ["-echo2", `@@${step ? "fill" : "copy"} ${i}`, ...args, dest, "-execute"]));
  // -overwrite_original_in_place keeps the target's extended attributes
  const { stderr } = await exiftool(["-common_args", "-overwrite_original_in_place", "-m"], lines);

  const errors = new Map<number, string>();
  let current = -1, fill = false;
  for (const line of stderr.split("\n")) {
    const marker = line.match(/^@@(copy|fill) (\d+)$/);
    if (marker) { fill = marker[1] === "fill"; current = Number(marker[2]); continue; }
    if (current < 0 || errors.has(current)) continue;
    // Nothing to fill in is expected; nothing to copy at all is not
    const error = line.match(/^Error: (.*?)(?: - .+)?$/)?.[1]
      ?? line.match(/^(File '.*' does not exist.*)$/)?.[1]
      ?? (!fill && /^Warning: No writable tags set/.test(line) ? "no metadata to copy from the reference" : undefined);
    if (error) errors.set(current, error);
  }

  const result: ApplyResult = { applied: [], failed: [] };
  pairs.forEach(({ dest }, i) => {
    const error = errors.get(i);
    if (error) result.failed.push({ file: dest, error });
    else result.applied.push(dest);
  });
  return result;
}

/** The pixel size of each file that has one, by path as given. */
async function readSizes(files: string[]): Promise<Map<string, Size>> {
  const { stdout } = await exiftool(["-j", "-n", "-ImageWidth", "-ImageHeight"], files);
  const sizes = new Map<string, Size>();
  let rows: { SourceFile: string; ImageWidth?: unknown; ImageHeight?: unknown }[] = [];
  try { rows = JSON.parse(stdout || "[]"); } catch { /* unreadable: no sizes */ }
  for (const { SourceFile, ImageWidth: width, ImageHeight: height } of rows) {
    if (typeof width === "number" && typeof height === "number") sizes.set(path.resolve(SourceFile), { width, height });
  }
  return sizes;
}
