# clean-assets-meta

Removes metadata from images: camera and owner details, location, dates,
editing software, keywords. It keeps the orientation and color profile so
images look the same after cleaning.

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

macOS's `com.apple.provenance` attribute stays: the system protects it.

## Development

```sh
pnpm test        # needs exiftool
pnpm typecheck
```
