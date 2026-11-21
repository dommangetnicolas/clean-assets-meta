# clean-assets-meta

Removes metadata from images and videos: camera and owner details, location,
dates, editing software, keywords. It keeps the orientation and color profile
so files look the same after cleaning. `apply` puts metadata back from a
reference file, e.g. the original of a stripped copy.

Requires Node 24+ and exiftool (`brew install exiftool`).

```sh
pnpm install
pnpm add -g "$PWD"              # makes `clean-assets-meta` available everywhere
```

On pnpm 11 and earlier, `pnpm link --global` does the same; `npm link` works
with any version. To run it without installing, use `pnpm start <command>`
from this folder.

## Usage

```sh
clean-assets-meta strip photo.jpg                  # replace the file with a clean one
clean-assets-meta strip clip.mov                   # videos work the same way
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

Formats: JPEG, PNG, HEIC/HEIF, AVIF, TIFF, WebP, GIF, and MP4, MOV, M4V and
3GP videos. Exits 1 if a file fails (the others are still cleaned) and 2 for
bad arguments.

#### Videos

A video's creation dates are stored in its headers. They can't be removed,
only set to zero, which is what `strip` does (`--gps-only` leaves them). The
rotation and color information are part of the video track and always stay,
even with `--all`. exiftool rewrites the whole file, so cleaning needs free disk
space the size of the video.

What `strip` can't remove:

- **Location recorded along the video**: GoPro, DJI drone, dashcam and some
  phone videos store GPS as a separate track inside the file, not as tags, so
  the route stays after cleaning.
- **MKV, WebM and AVI**: exiftool can't write them, so they aren't supported.

Stripping an iPhone Live Photo's video breaks its link to the photo; keep it
with `-k ContentIdentifier`.

### Applying metadata from a reference

```sh
clean-assets-meta apply original.jpg clean.jpg     # copy original.jpg's metadata onto clean.jpg
clean-assets-meta apply original.jpg ./variants    # the same metadata on every file in a folder
clean-assets-meta apply ./exports ./clean -r       # each file gets the one at the same path in ./exports
clean-assets-meta apply original.jpg clean.jpg --no-gps -x Artist
```

Tags go back to where they were in the reference (EXIF, XMP, IPTC…), added to
what the file already has; tags of the same name are replaced. The
orientation and color profile are only copied when the image has none, since
an edited copy may have been rotated or converted. The orientation also needs
the image to have the reference's pixel size: an export without one is usually
already upright, and rotating it again would turn it sideways. A video's
header dates are copied, but never its rotation: every video has one, so
there's no telling whether an export was already turned. Files are updated in
place and keep their extended attributes.

| Option | |
|---|---|
| `-r, --recursive` | also look in subfolders |
| `--no-gps` | leave out location data |
| `-x, --exclude <tag>` | leave out this tag, e.g. `Artist` or `XMP:all` (repeatable) |
| `-n, --dry-run` | list which reference goes to which file, change nothing |

With folders, files that have no file at the same path in the reference
folder are skipped and reported. Exits 1 if a file fails or is skipped.

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
