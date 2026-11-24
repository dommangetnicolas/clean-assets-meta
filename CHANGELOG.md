# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-24

### Added

- `strip` command: removes metadata from images (JPEG, PNG, HEIC/HEIF, AVIF, TIFF, WebP, GIF) and videos (MP4, MOV, M4V, 3GP), keeping the orientation and color profile. Options to write copies elsewhere (`--out`), remove everything (`--all`) or only the location (`--gps-only`), keep chosen tags (`--keep`) and preview (`--dry-run`).
- macOS extended attributes (download source, quarantine, Finder tags) are cleared too, unless `--keep-xattrs`.
- `apply` command: copies metadata from a reference file back onto images and videos, one reference for many files or folders matched by relative path.
- Presets: save options with `--save-preset <name>`, reuse them with `--preset <name>`, list them with `presets`. Project presets can be shared in `.clean-assets-meta.json`.
- `--version` flag.

[Unreleased]: https://github.com/dommangetnicolas/clean-assets-meta/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dommangetnicolas/clean-assets-meta/releases/tag/v1.0.0
