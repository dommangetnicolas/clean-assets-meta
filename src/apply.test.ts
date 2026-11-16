import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { apply, applyArgs, pairTargets } from "./apply.ts";
import { collectTargets, readTags, strip } from "./strip.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
let dir: string;

const TAGGED = [
  "-Make=Apple", "-Model=iPhone", "-Artist=Someone", "-Copyright=© Someone",
  "-DateTimeOriginal=2026:01:02 03:04:05",
  "-GPSLatitude=48.85", "-GPSLatitudeRef=N", "-GPSLongitude=2.35", "-GPSLongitudeRef=E",
  "-XMP-dc:Creator=Someone", "-IPTC:Keywords=private",
];

/** A copy of a fixture with the tags above (and an orientation). */
function tagged(fixture: string, name: string): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixture), file);
  const exifOnly = path.extname(file) === ".jpg" ? [] : ["-IPTC:all="];
  execFileSync("exiftool", ["-q", "-m", "-overwrite_original", ...TAGGED, "-Orientation#=6", ...exifOnly, file]);
  return file;
}

/** A stripped copy of `src` at `name`. */
async function stripped(src: string, name: string, all = false): Promise<string> {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(src, file);
  const { failed } = await strip(collectTargets([file]), { all });
  assert.deepEqual(failed, []);
  return file;
}

const sizeOf = async (file: string) => {
  const [{ ImageWidth: width, ImageHeight: height }] = JSON.parse(execFileSync("exiftool", ["-j", "-n", "-ImageWidth", "-ImageHeight", file], { encoding: "utf8" }));
  return { width: width as number, height: height as number };
};
const tagsOf = async (file: string) => (await readTags([file])).get(path.resolve(file)) ?? {};
const names = async (file: string) => Object.keys(await tagsOf(file)).map((k) => k.split(":")[1]);

before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-assets-meta-apply-"))));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("applyArgs", () => {
  test("copies all tags to the same groups, then fills in orientation and color profile", () => {
    assert.deepEqual(applyArgs("r.jpg", {}, { width: 40, height: 30 }), [
      ["-tagsFromFile", "r.jpg", "-all:all", "--Orientation"],
      ["-if", "not $Orientation and $ImageWidth# == 40 and $ImageHeight# == 30", "-tagsFromFile", "r.jpg", "-Orientation"],
      ["-if", "not $ICC_Profile:all", "-tagsFromFile", "r.jpg", "-ICC_Profile"],
    ]);
  });
  test("never copies the orientation without the reference's size", () => {
    assert.ok(!applyArgs("r.jpg").flat().includes("-Orientation"));
  });
  test("leaves out excluded tags", () => {
    const [copy, ...fill] = applyArgs("r.jpg", { noGps: true, exclude: ["Artist", "IFD0:Orientation", "icc_profile"] });
    assert.deepEqual(copy, ["-tagsFromFile", "r.jpg", "-all:all", "--Orientation", "--gps:all", "--GPS*", "--Artist", "--IFD0:Orientation", "--icc_profile"]);
    assert.deepEqual(fill, []);
  });
});

describe("pairTargets", () => {
  test("a reference file goes to every target, folders included", () => {
    const d = path.join(dir, "pair-file");
    fs.mkdirSync(path.join(d, "imgs"), { recursive: true });
    for (const f of ["ref.jpg", "a.jpg", "imgs/b.png", "imgs/notes.txt"]) fs.writeFileSync(path.join(d, f), "");
    const { pairs, unmatched } = pairTargets(path.join(d, "ref.jpg"), [path.join(d, "a.jpg"), path.join(d, "imgs")]);
    assert.deepEqual(pairs.map((p) => path.basename(p.dest)).sort(), ["a.jpg", "b.png"]);
    assert.ok(pairs.every((p) => p.ref === path.join(d, "ref.jpg")));
    assert.deepEqual(unmatched, []);
  });

  test("folders are matched by relative path, in subfolders with recursive", () => {
    const refs = path.join(dir, "pair-dir", "originals");
    const imgs = path.join(dir, "pair-dir", "clean");
    for (const f of ["a.jpg", "sub/b.jpg"]) {
      fs.mkdirSync(path.dirname(path.join(refs, f)), { recursive: true });
      fs.writeFileSync(path.join(refs, f), "");
    }
    for (const f of ["a.jpg", "sub/b.jpg", "new.jpg"]) {
      fs.mkdirSync(path.dirname(path.join(imgs, f)), { recursive: true });
      fs.writeFileSync(path.join(imgs, f), "");
    }
    assert.equal(pairTargets(refs, [imgs]).pairs.length, 1);
    const { pairs, unmatched } = pairTargets(refs, [imgs], { recursive: true });
    assert.deepEqual(pairs.find((p) => p.dest.endsWith("b.jpg"))?.ref, path.join(refs, "sub", "b.jpg"));
    assert.equal(pairs.length, 2);
    assert.deepEqual(unmatched, [path.join(imgs, "new.jpg")]);
  });

  test("rejects missing files, a folder reference with file targets, and the reference as target", () => {
    const d = path.join(dir, "pair-bad");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "a.jpg"), "");
    fs.writeFileSync(path.join(d, "a.txt"), "");
    assert.throws(() => pairTargets(path.join(d, "nope.jpg"), [path.join(d, "a.jpg")]), /not found/);
    assert.throws(() => pairTargets(d, [path.join(d, "a.jpg")]), /one target folder/);
    assert.throws(() => pairTargets(d, [d]), /same/);
    assert.throws(() => pairTargets(path.join(d, "a.jpg"), [path.join(d, "a.jpg")]), /reference itself/);
    assert.throws(() => pairTargets(path.join(d, "a.jpg"), [path.join(d, "a.txt")]), /not a supported image/);
  });
});

describe("apply", () => {
  for (const fixture of ["tiny.jpg", "tiny.png", "tiny.heic"]) {
    test(`${fixture}: puts back what strip removed`, async () => {
      const original = tagged(fixture, `orig-${fixture}`);
      const clean = await stripped(original, `clean-${fixture}`);
      assert.ok(!(await names(clean)).includes("Make"));

      const { applied, failed } = await apply(pairTargets(original, [clean]).pairs);
      assert.deepEqual(failed, []);
      assert.deepEqual(applied, [clean]);

      const want = ["Make", "Model", "Artist", "Copyright", "DateTimeOriginal", "GPSLatitude", "Creator", ...(fixture === "tiny.jpg" ? ["Keywords"] : [])];
      const left = await names(clean);
      for (const tag of want) assert.ok(left.includes(tag), `${tag} should be back: ${left.join()}`);
      assert.equal((await tagsOf(clean))["IFD0:Orientation"], 6);
    });
  }

  const ADOBE_RGB = "/System/Library/ColorSync/Profiles/AdobeRGB1998.icc";
  test("keeps the target's own orientation and color profile", { skip: !fs.existsSync(ADOBE_RGB) && "needs a macOS color profile" }, async () => {
    const original = tagged("tiny.jpg", "own-orig.jpg");
    const clean = await stripped(original, "own-clean.jpg");
    // An export rotated upright and converted to another profile
    execFileSync("exiftool", ["-q", "-m", "-overwrite_original", "-Orientation#=1", `-ICC_Profile<=${ADOBE_RGB}`, clean]);
    await apply(pairTargets(original, [clean]).pairs);
    const tags = await tagsOf(clean);
    assert.equal(tags["IFD0:Orientation"], 1);
    assert.equal(tags["ICC_Profile:ProfileDescription"], "Adobe RGB (1998)");
    assert.equal(tags["IFD0:Make"], "Apple");
  });

  test("leaves an export without orientation as it is when its size differs", { skip: process.platform !== "darwin" && "needs sips" }, async () => {
    const original = tagged("tiny.jpg", "upright-orig.jpg");
    const clean = await stripped(original, "upright-clean.jpg", true);
    // An export already rotated upright and resized, without orientation
    execFileSync("sips", ["--resampleHeightWidth", "12", "8", clean, "--out", clean], { stdio: "ignore" });
    assert.deepEqual(await sizeOf(clean), { width: 8, height: 12 });
    await apply(pairTargets(original, [clean]).pairs);
    const tags = await tagsOf(clean);
    assert.equal(tags["IFD0:Orientation"], undefined);
    assert.equal(tags["IFD0:Make"], "Apple");
  });

  test("puts back orientation and color profile when strip --all removed them", async () => {
    const original = tagged("tiny.jpg", "icc-orig.jpg");
    const clean = await stripped(original, "icc-clean.jpg", true);
    assert.ok(!(await names(clean)).includes("ProfileDescription"));
    await apply(pairTargets(original, [clean]).pairs);
    assert.equal((await tagsOf(clean))["ICC_Profile:ProfileDescription"], "Display P3");
    assert.equal((await tagsOf(clean))["IFD0:Orientation"], 6);
  });

  test("--no-gps and --exclude leave tags out", async () => {
    const original = tagged("tiny.jpg", "x-orig.jpg");
    const clean = await stripped(original, "x-clean.jpg");
    await apply(pairTargets(original, [clean]).pairs, { noGps: true, exclude: ["Artist"] });
    const left = await names(clean);
    assert.ok(!left.some((n) => n.startsWith("GPS")), left.join());
    assert.ok(!left.includes("Artist"));
    assert.ok(left.includes("Make") && left.includes("Copyright"));
  });

  test("restores a stripped folder from its originals", async () => {
    const originals = path.join(dir, "folder", "originals");
    const out = path.join(dir, "folder", "clean");
    tagged("tiny.jpg", "folder/originals/a.jpg");
    tagged("tiny.png", "folder/originals/sub/b.png");
    await strip(collectTargets([originals], { recursive: true, outDir: out }));
    assert.ok(!(await names(path.join(out, "sub", "b.png"))).includes("Make"));

    const { pairs } = pairTargets(originals, [out], { recursive: true });
    const { applied, failed } = await apply(pairs);
    assert.deepEqual(failed, []);
    assert.equal(applied.length, 2);
    for (const f of ["a.jpg", "sub/b.png"]) assert.ok((await names(path.join(out, f))).includes("Make"), f);
  });

  test("reports a broken target and a reference without metadata, and still applies the others", async () => {
    const original = tagged("tiny.jpg", "batch-orig.jpg");
    const good = await stripped(original, "batch/good.jpg");
    const broken = path.join(dir, "batch", "broken.jpg");
    fs.writeFileSync(broken, "not an image");
    const empty = path.join(dir, "batch-empty.png");
    fs.copyFileSync(path.join(FIXTURES, "tiny.png"), empty);
    execFileSync("exiftool", ["-q", "-m", "-overwrite_original", "-all=", empty]);
    const fromEmpty = await stripped(original, "batch/from-empty.jpg");

    const { applied, failed } = await apply([
      { ref: original, dest: good },
      { ref: original, dest: broken },
      { ref: empty, dest: fromEmpty },
    ]);
    assert.deepEqual(applied, [good]);
    assert.deepEqual(failed.map((f) => path.basename(f.file)), ["broken.jpg", "from-empty.jpg"]);
    assert.match(failed[0].error, /Not a valid JPG/);
    assert.match(failed[1].error, /no metadata/);
  });
});
