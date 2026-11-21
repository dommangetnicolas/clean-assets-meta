# Contributing

Thanks for your interest in clean-assets-meta! Bug reports, ideas and pull requests are welcome.

## Getting started

You need Node.js 24+, [pnpm](https://pnpm.io) and [exiftool](https://exiftool.org/install.html)
(`brew install exiftool` on macOS).

```bash
git clone https://github.com/dommangetnicolas/clean-assets-meta.git
cd clean-assets-meta
pnpm install
pnpm start strip photo.jpg -n   # runs the CLI from source
pnpm test                       # runs the test suite (needs exiftool)
pnpm typecheck
```

Node runs the TypeScript in `src/` directly, so there's no build step while you work. The
package published to npm is compiled to `dist/` by `pnpm build`, because Node won't run
TypeScript from `node_modules`. To try that version as users get it:

```bash
pnpm pack
npm install -g ./clean-assets-meta-*.tgz
```

Only use TypeScript syntax Node can strip (no enums or namespaces); `pnpm typecheck` enforces
it with `erasableSyntaxOnly`.

A few tests need macOS (`xattr`, `sips`, a system color profile) and are skipped elsewhere.

## Project layout

| Path | What it is |
| --- | --- |
| `src/cli.ts` | Argument parsing, help texts and output for each command |
| `src/strip.ts` | The `strip` command: finding files, building exiftool arguments, xattrs |
| `src/apply.ts` | The `apply` command: pairing references with targets, copying tags |
| `src/presets.ts` | Loading, merging and saving presets |
| `src/exiftool.ts` | Running exiftool and the list of supported formats |
| `src/fixtures/` | Tiny test files, one per format |
| `scripts/changelog.sh` | Bumps the version and updates `CHANGELOG.md` for releases |
| `site/` | The landing page, published with GitHub Pages |

## Pull requests

- Keep changes focused; one topic per pull request.
- Add or update tests next to the code (`src/*.test.ts`) when you change what gets written.
- Make sure `pnpm typecheck` and `pnpm test` pass.
- When you change an option, update both the command's `--help` text in `src/cli.ts` and the README.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Releasing (maintainers)

See [docs/release.md](docs/release.md).
