import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { asFlags, checkValues, loadPresets, PROJECT_FILE, projectPresetsFile, resolveOptions, savePreset, userPresetsFile, type OptionSpec } from "./presets.ts";

const SPEC = {
  recursive: { type: "boolean" },
  all: { type: "boolean" },
  out: { type: "string" },
  keep: { type: "string", multiple: true },
} satisfies OptionSpec;

let dir: string;
const write = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
};

before(() => (dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clean-assets-meta-presets-")))));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("files", () => {
  test("the user file follows XDG_CONFIG_HOME", () => {
    assert.equal(userPresetsFile({ XDG_CONFIG_HOME: "/cfg" }), "/cfg/clean-assets-meta/presets.json");
    assert.equal(userPresetsFile({}), path.join(os.homedir(), ".config", "clean-assets-meta", "presets.json"));
  });

  test("the project file is found in a parent folder", () => {
    const root = path.join(dir, "proj");
    write(path.join(root, PROJECT_FILE), { presets: {} });
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    assert.equal(projectPresetsFile(path.join(root, "a", "b")), path.join(root, PROJECT_FILE));
  });

  test("the project's presets win over the user's of the same name", () => {
    const user = path.join(dir, "load", "user.json");
    const root = path.join(dir, "load", "proj");
    write(user, { presets: { web: { strip: { all: true } }, mine: { apply: { recursive: true } } } });
    write(path.join(root, PROJECT_FILE), { presets: { web: { strip: { keep: ["Copyright"] } } } });
    const presets = loadPresets({ cwd: root, userFile: user });
    assert.deepEqual(presets.get("web")?.commands, { strip: { keep: ["Copyright"] } });
    assert.equal(presets.get("web")?.file, path.join(root, PROJECT_FILE));
    assert.deepEqual(presets.get("mine")?.commands, { apply: { recursive: true } });
  });

  test("a missing user file is fine; a broken one or an unknown command is an error", () => {
    const empty = path.join(dir, "none");
    fs.mkdirSync(empty, { recursive: true });
    assert.equal(loadPresets({ cwd: empty, userFile: path.join(dir, "nope.json") }).size, 0);
    write(path.join(dir, "broken.json"), "{ nope");
    assert.throws(() => loadPresets({ cwd: empty, userFile: path.join(dir, "broken.json") }), /can't read presets/);
    write(path.join(dir, "cmd.json"), { presets: { x: { clean: {} } } });
    assert.throws(() => loadPresets({ cwd: empty, userFile: path.join(dir, "cmd.json") }), /unknown command "clean"/);
  });
});

describe("resolveOptions", () => {
  const presets = new Map([
    ["web", { name: "web", file: "f", commands: { strip: { all: true, keep: ["Copyright"] } } }],
    ["deep", { name: "deep", file: "f", commands: { strip: { recursive: true, keep: "Artist" } } }],
  ]);

  test("presets apply in order, then the command line; lists add up", () => {
    assert.deepEqual(resolveOptions("strip", { out: "x", keep: ["Credit"] }, ["web", "deep"], SPEC, presets), {
      all: true, recursive: true, out: "x", keep: ["Copyright", "Artist", "Credit"],
    });
  });

  test("the command line can turn a preset's option off", () => {
    assert.equal(resolveOptions("strip", { all: false }, ["web"], SPEC, presets).all, false);
  });

  test("unknown presets, presets for another command, and bad options are errors", () => {
    assert.throws(() => resolveOptions("strip", {}, ["nope"], SPEC, presets), /no preset named "nope" \(have: web, deep\)/);
    assert.throws(() => resolveOptions("apply", {}, ["web"], SPEC, presets), /no options for apply/);
    assert.throws(() => checkValues({ al: true }, SPEC, "p"), /unknown option "al"/);
    assert.throws(() => checkValues({ all: "yes" }, SPEC, "p"), /"all" should be a boolean/);
    assert.throws(() => checkValues({ keep: [1] }, SPEC, "p"), /list of strings/);
  });
});

describe("savePreset", () => {
  test("adds to the file, keeping other presets and the preset's other command", () => {
    const file = path.join(dir, "save", "presets.json");
    savePreset(file, "web", "strip", { all: true, keep: [], out: undefined });
    savePreset(file, "web", "apply", { gps: false });
    savePreset(file, "other", "strip", { recursive: true });
    savePreset(file, "web", "strip", { keep: ["Copyright"] });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      presets: { web: { strip: { keep: ["Copyright"] }, apply: { gps: false } }, other: { strip: { recursive: true } } },
    });
  });

  test("won't overwrite a file it can't read", () => {
    const file = path.join(dir, "save-broken.json");
    write(file, "{ nope");
    assert.throws(() => savePreset(file, "web", "strip", {}));
    assert.equal(fs.readFileSync(file, "utf8"), "{ nope");
  });
});

test("asFlags writes options as flags", () => {
  assert.equal(asFlags({ all: true, gps: false, keep: ["Copyright", "My Tag"], out: "./clean" }), "--all --no-gps --keep Copyright --keep 'My Tag' --out ./clean");
});

describe("cli", () => {
  const CLI = path.join(import.meta.dirname, "cli.ts");
  const cli = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, XDG_CONFIG_HOME: path.join(cwd, "config") } });
    return { code: r.status, out: r.stdout + r.stderr };
  };

  test("--save-preset saves the options and --preset uses them", () => {
    const cwd = path.join(dir, "cli");
    fs.mkdirSync(path.join(cwd, "imgs", "sub"), { recursive: true });
    fs.copyFileSync(path.join(import.meta.dirname, "fixtures", "tiny.jpg"), path.join(cwd, "imgs", "sub", "a.jpg"));
    execFileSync("exiftool", ["-q", "-overwrite_original", "-Make=Apple", "-Copyright=Me", path.join(cwd, "imgs", "sub", "a.jpg")]);

    const saved = cli(cwd, "strip", "-r", "-k", "Copyright", "-o", "clean", "--save-preset", "web");
    assert.equal(saved.code, 0, saved.out);
    assert.match(saved.out, /saved preset "web" for strip: --recursive --out clean --keep Copyright/);
    assert.match(cli(cwd, "presets").out, /web .*\n {2}strip: --recursive --out clean --keep Copyright/);

    const run = cli(cwd, "strip", "imgs", "-p", "web");
    assert.equal(run.code, 0, run.out);
    const tags = execFileSync("exiftool", ["-s", "-s", "-s", "-Make", "-Copyright", path.join(cwd, "clean", "sub", "a.jpg")], { encoding: "utf8" });
    assert.equal(tags.trim(), "Me", "Copyright kept, Make gone");

    const off = cli(cwd, "strip", "imgs", "-p", "web", "--no-recursive", "-n");
    assert.match(off.out, /no images or videos found/);
    assert.match(cli(cwd, "strip", "imgs", "-p", "nope").out, /no preset named "nope"/);
    assert.match(cli(cwd, "apply", "a.jpg", "b.jpg", "-p", "web").out, /no options for apply/);
  });
});
