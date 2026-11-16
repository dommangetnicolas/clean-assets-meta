# clean-assets-meta

Removes metadata from images: camera and owner details, location, dates,
editing software, keywords. It keeps the orientation and color profile so
images look the same after cleaning. `apply` puts metadata back from a
reference file, e.g. the original of a stripped copy.

Requires Node 24+ and exiftool (`brew install exiftool`).

```sh
pnpm install
pnpm link --global              # makes `clean-assets-meta` available everywhere
```

## Usage

```sh
clean-assets-meta strip photo.jpg                  # replace the file with a clean one
clean-assets-meta strip ./exports -r -o ./clean    # clean copies, originals untouched
clean-assets-meta strip ./exports -r -n            # see what metadata each file has
clean-assets-meta strip photo.jpg --gps-only       # remove location only
clean-assets-meta strip photo.jpg --all -k Copyright
```

| Option | |
|---|---|
| `-r, --recursive` | also look in subfolders |
| `-o, --out <dir>` | write cleaned copies there (keeping subfolders), never overwriting a file already there |
| `--all` | also remove the orientation and color profile |
| `--gps-only` | remove location data only |
| `-k, --keep <tag>` | keep this tag too (repeatable) |
| `--keep-xattrs` | leave macOS extended attributes (download source, quarantine, Finder tags) |
| `-n, --dry-run` | list files and their metadata, change nothing |

Formats: JPEG, PNG, HEIC/HEIF, AVIF, TIFF, WebP, GIF. Exits 1 if a file
fails (the others are still cleaned) and 2 for bad arguments.

### Applying metadata from a reference

```sh
clean-assets-meta apply original.jpg clean.jpg     # copy original.jpg's metadata onto clean.jpg
clean-assets-meta apply original.jpg ./variants    # the same metadata on every image in a folder
clean-assets-meta apply ./exports ./clean -r       # each image gets the file at the same path in ./exports
clean-assets-meta apply original.jpg clean.jpg --no-gps -x Artist
```

Tags go back to where they were in the reference (EXIF, XMP, IPTC…), added to
what the image already has; tags of the same name are replaced. The
orientation and color profile are only copied when the image has none, since
an edited copy may have been rotated or converted. Images are updated in place
and keep their extended attributes.

| Option | |
|---|---|
| `-r, --recursive` | also look in subfolders |
| `--no-gps` | leave out location data |
| `-x, --exclude <tag>` | leave out this tag, e.g. `Artist` or `XMP:all` (repeatable) |
| `-n, --dry-run` | list which reference goes to which image, change nothing |

With folders, images that have no file at the same path in the reference
folder are skipped and reported. Exits 1 if an image fails or is skipped.

macOS's `com.apple.provenance` attribute stays: the system protects it.

## Presets

Save options you use often under a name, then reuse them with `-p, --preset`
on `strip` or `apply`:

```sh
clean-assets-meta strip -r --all -k Copyright -o ./clean --save-preset web
clean-assets-meta strip ./exports -p web           # same as typing the options above
clean-assets-meta strip ./exports -p web -o ./out  # a flag on the command line wins
clean-assets-meta strip ./exports -p web --no-all  # --no-<flag> turns off a preset's flag
clean-assets-meta presets                          # list them
```

`--save-preset` with files given saves and runs; without, it only saves.
Several `-p` can be combined: later ones win, and lists like `--keep` add up.

Presets are saved to `~/.config/clean-assets-meta/presets.json` (or under
`$XDG_CONFIG_HOME`). To share presets with a project, put them in a
`.clean-assets-meta.json` at its root; it is found from any subfolder and wins
over your own presets of the same name. Options are named like the long flags,
per command:

```json
{
  "presets": {
    "web": {
      "strip": { "recursive": true, "all": true, "keep": ["Copyright"] },
      "apply": { "gps": false, "exclude": ["Artist"] }
    }
  }
}
```

A relative `out` is relative to the folder you run the command from.

## Development

```sh
pnpm test        # needs exiftool
pnpm typecheck
```
