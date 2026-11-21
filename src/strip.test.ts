import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { collectTargets, readTags, strip, stripArgs, summarize } from "./strip.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
let dir: string;

// Tags a phone photo or an editor would leave
const TAGGED = [
  "-Make=Apple", "-Model=iPhone", "-SerialNumber=ABC123", "-Software=Editor 1.0",
  "-Artist=Someone", "-Copyright=© Someone", "-DateTimeOriginal=2026:01:02 03:04:05",
  "-GPSLatitude=48.85", "-GPSLatitudeRef=N", "-GPSLongitude=2.35", "-GPSLongitudeRef=E",
  "-XMP-dc:Creator=Someone", "-XMP-xmp:CreatorTool=Editor", "-IPTC:Keywords=private",
];

/** A copy of a fixture in the test folder, with the tags above (and an orientation). */
function tagged(fixture: string, name = fixture): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixture), file);
  const exifOnly = path.extname(file) === ".jpg" ? [] : ["-IPTC:all="]; // IPTC only in JPEG here
  execFileSync("exiftool", ["-q", "-m", "-overwrite_original", ...TAGGED, "-Orientation#=6", ...exifOnly, file]);
  return file;
}

// Tags a phone video would have, in the places exiftool reads them from
const VIDEO_TAGGED = [
  "-Keys:Make=Apple", "-Keys:Model=iPhone", "-Keys:Software=17.0", "-Keys:CreationDate=2026:01:02 03:04:05+01:00",
  "-Keys:GPSCoordinates=48.85, 2.35, 0", "-Keys:LocationName=Home", "-UserData:Artist=Someone",
  "-ItemList:Title=private", "-XMP-dc:Creator=Someone",
  "-QuickTime:CreateDate=2026:01:02 03:04:05", "-TrackCreateDate=2026:01:02 03:04:05", "-MediaCreateDate=2026:01:02 03:04:05",
];

/** A copy of a video fixture with the tags above, turned 90°. */
function taggedVideo(fixture: string, name: string, target: string): string {
  const file = path.join(target, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixture), file);
  execFileSync("exiftool", ["-q", "-m", "-overwrite_original", ...VIDEO_TAGGED, "-Rotation=90", file]);
  return file;
}
const rotationOf = (file: string) => Number(execFileSync("exiftool", ["-s3", "-n", "-Rotation", file], { encoding: "utf8" }).trim());

const tagsOf = async (file: string) => (await readTags([file])).get(path.resolve(file)) ?? {};
const names = (tags: Record<string, unknown>) => Object.keys(tags).map((k) => k.split(":")[1]);

before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-assets-meta-"))));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const DATES = ["-QuickTime:CreateDate=", "-QuickTime:ModifyDate=", "-Track*Date=", "-Media*Date="];

describe("stripArgs", () => {
  test("keeps orientation and color profile by default", () => {
    assert.deepEqual(stripArgs(), ["-all=", ...DATES, "-tagsFromFile", "@", "-Orientation", "-ICC_Profile"]);
  });
  test("--all keeps nothing unless asked", () => {
    assert.deepEqual(stripArgs({ all: true }), ["-all=", ...DATES]);
    assert.deepEqual(stripArgs({ all: true, keep: ["Copyright"] }), ["-all=", ...DATES, "-tagsFromFile", "@", "-Copyright"]);
  });
  test("--gps-only refuses other options", () => {
    assert.deepEqual(stripArgs({ gpsOnly: true }), ["-gps:all=", "-GPS*=", "-QuickTime:Location*="]);
    assert.throws(() => stripArgs({ gpsOnly: true, all: true }));
  });
});

describe("collectTargets", () => {
  test("finds images in folders, in subfolders with recursive, and maps them to the output folder", () => {
    const src = path.join(dir, "collect");
    fs.mkdirSync(path.join(src, "sub"), { recursive: true });
    for (const f of ["a.jpg", "b.PNG", "v.MOV", "notes.txt", "._a.jpg", "sub/c.heic", "sub/d.mp4", "sub/e.mkv"]) fs.writeFileSync(path.join(src, f), "");

    assert.deepEqual(collectTargets([src]).map((t) => path.basename(t.src)).sort(), ["a.jpg", "b.PNG", "v.MOV"]);
    const deep = collectTargets([src], { recursive: true, outDir: path.join(dir, "out") });
    assert.equal(deep.length, 5);
    assert.equal(deep.find((t) => t.src.endsWith("c.heic"))?.dest, path.join(dir, "out", "sub", "c.heic"));
  });
  test("rejects missing files, unsupported files and clashing outputs", () => {
    assert.throws(() => collectTargets([path.join(dir, "nope.jpg")]), /not found/);
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    assert.throws(() => collectTargets([path.join(dir, "notes.txt")]), /not a supported image/);
    fs.mkdirSync(path.join(dir, "x"), { recursive: true });
    fs.mkdirSync(path.join(dir, "y"), { recursive: true });
    fs.writeFileSync(path.join(dir, "x", "same.jpg"), "");
    fs.writeFileSync(path.join(dir, "y", "same.jpg"), "");
    assert.throws(() => collectTargets([path.join(dir, "x"), path.join(dir, "y")], { outDir: path.join(dir, "o") }), /two files/);
  });
});

describe("strip", () => {
  for (const fixture of ["tiny.jpg", "tiny.png", "tiny.heic"]) {
    test(`${fixture}: removes everything but orientation and color profile`, async () => {
      const file = tagged(fixture, `default-${fixture}`);
      const hadIcc = names(await tagsOf(file)).includes("ProfileDescription");
      const { cleaned, failed } = await strip(collectTargets([file]));
      assert.deepEqual(failed, []);
      assert.deepEqual(cleaned, [file]);

      const left = await tagsOf(file);
      for (const gone of ["Make", "Model", "SerialNumber", "Software", "Artist", "Copyright", "DateTimeOriginal", "GPSLatitude", "Creator", "CreatorTool", "Keywords"]) {
        assert.ok(!names(left).includes(gone), `${gone} should be gone: ${JSON.stringify(left)}`);
      }
      assert.equal(left["IFD0:Orientation"], 6);
      if (hadIcc) assert.equal(left["ICC_Profile:ProfileDescription"], "Display P3");
      assert.deepEqual(summarize(left), { tags: 1, gps: false, icc: hadIcc }, "only Orientation counts as metadata");
    });
  }

  for (const fixture of ["tiny.mov", "tiny.mp4"]) {
    test(`${fixture}: removes metadata, zeroes the header dates, keeps the rotation`, async () => {
      const file = taggedVideo(fixture, `default-${fixture}`, dir);
      const before = await tagsOf(file);
      assert.ok(summarize(before).gps);
      assert.equal(summarize(before).tags, 15, Object.keys(before).join());

      const { cleaned, failed } = await strip(collectTargets([file]));
      assert.deepEqual(failed, []);
      assert.deepEqual(cleaned, [file]);

      const left = await tagsOf(file);
      for (const gone of ["Make", "Model", "Software", "CreationDate", "GPSCoordinates", "LocationName", "Artist", "Title", "Creator"]) {
        assert.ok(!names(left).includes(gone), `${gone} should be gone: ${JSON.stringify(left)}`);
      }
      for (const [key, value] of Object.entries(left)) if (key.endsWith("Date")) assert.match(String(value), /^[0: ]+$/, key);
      assert.equal(rotationOf(file), 90);
      assert.deepEqual(summarize(left), { tags: 0, gps: false, icc: false });
    });
  }

  test("video --gps-only removes the coordinates and place name, and nothing else", async () => {
    const file = taggedVideo("tiny.mov", "gps.mov", dir);
    await strip(collectTargets([file]), { gpsOnly: true });
    const left = names(await tagsOf(file));
    assert.ok(!left.includes("GPSCoordinates") && !left.includes("LocationName"), left.join());
    assert.ok(left.includes("Make") && left.includes("CreationDate") && left.includes("Artist"));
    assert.equal((await tagsOf(file))["QuickTime:CreateDate"], "2026:01:02 03:04:05");
  });

  test("--all removes orientation and color profile too; --keep keeps a tag", async () => {
    const file = tagged("tiny.jpg", "all.jpg");
    await strip(collectTargets([file]), { all: true, keep: ["Copyright"] });
    const left = names(await tagsOf(file));
    assert.ok(!left.includes("Orientation") && !left.includes("ProfileDescription"));
    assert.ok(left.includes("Copyright"));
    assert.ok(!left.includes("Artist"));
  });

  test("--gps-only removes location and nothing else", async () => {
    const file = tagged("tiny.jpg", "gps.jpg");
    await strip(collectTargets([file]), { gpsOnly: true });
    const left = names(await tagsOf(file));
    assert.ok(!left.some((n) => n.startsWith("GPS")), left.join());
    assert.ok(left.includes("Make") && left.includes("Artist"));
  });

  test("--out leaves the original, and won't overwrite an existing copy", async () => {
    const file = tagged("tiny.jpg", "src/keep.jpg");
    const out = path.join(dir, "cleaned");
    const first = await strip(collectTargets([file], { outDir: out }));
    assert.deepEqual(first.cleaned, [path.join(out, "keep.jpg")]);
    assert.ok(names(await tagsOf(file)).includes("Make"), "original untouched");
    assert.ok(!names(await tagsOf(path.join(out, "keep.jpg"))).includes("Make"));

    const again = await strip(collectTargets([file], { outDir: out }));
    assert.equal(again.cleaned.length, 0);
    assert.match(again.failed[0].error, /already exists/);
  });

  test("reports a broken file and still cleans the others", async () => {
    const good = tagged("tiny.jpg", "batch/good.jpg");
    fs.writeFileSync(path.join(dir, "batch", "broken.jpg"), "not an image");
    const { cleaned, failed } = await strip(collectTargets([path.join(dir, "batch")]));
    assert.deepEqual(cleaned, [good]);
    assert.equal(failed.length, 1);
    assert.ok(failed[0].file.endsWith("broken.jpg"));
  });

  test("clears macOS extended attributes unless --keep-xattrs", { skip: process.platform !== "darwin" }, async () => {
    // macOS protects com.apple.provenance; xattr can't remove it
    const attrs = (f: string) =>
      execFileSync("xattr", [f], { encoding: "utf8" }).split("\n").filter((a) => a && a !== "com.apple.provenance").join("\n");
    const a = tagged("tiny.jpg", "xattr-a.jpg");
    const b = tagged("tiny.jpg", "xattr-b.jpg");
    for (const f of [a, b]) execFileSync("xattr", ["-w", "com.apple.metadata:kMDItemWhereFroms", "https://example.com", f]);
    await strip(collectTargets([a]));
    await strip(collectTargets([b]), { keepXattrs: true });
    assert.equal(attrs(a), "");
    assert.match(attrs(b), /kMDItemWhereFroms/);
  });
});
