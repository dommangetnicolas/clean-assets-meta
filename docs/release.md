# Releasing clean-assets-meta

Releases are tested, published to npm and announced on GitHub by GitHub Actions. You never run
`npm publish` by hand (except the very first time, see [One-time setup](#one-time-setup)).

## Versioning

clean-assets-meta follows [Semantic Versioning](https://semver.org/):

- **Patch** (`1.0.1`): bug fixes only.
- **Minor** (`1.1.0`): new commands, options or formats that don't change existing behavior.
- **Major** (`2.0.0`): breaking changes, such as removing an option, changing what `strip` removes
  by default, or dropping a Node version.

The version is never written in the source: `package.json` says `0.0.0-development`. The Release
workflow sets the real one from the tag (`v1.2.3` → `1.2.3`) just before packing.

## Releasing from GitHub (recommended)

1. **Make sure `main` is green** and that **Unreleased** in [CHANGELOG.md](../CHANGELOG.md) lists
   everything that ships.

2. **Run "Prepare release".** In the Actions tab, open
   [Prepare release](../.github/workflows/prepare-release.yml), click **Run workflow**, and pick
   `patch`, `minor` or `major` (or type an exact version; use `1.0.0` for the first release). From
   the terminal:

   ```bash
   gh workflow run prepare-release.yml -f bump=minor
   ```

   It moves the Unreleased entries under `## [1.2.3] - YYYY-MM-DD`, updates the comparison links,
   and pushes a `release/v1.2.3` branch.

3. **Open the pull request.** The run's summary page has an **Open the release pull request** link
   with the title and changelog already filled in. You open it yourself (rather than the workflow)
   so that CI runs on it, and so Actions never needs permission to create pull requests.

   ```bash
   gh pr create --head release/v1.2.3 --fill
   ```

4. **Merge the pull request.** The [Release workflow](../.github/workflows/release.yml) then runs
   the tests, packs the package, publishes it to npm with provenance, tags the merge commit
   `v1.2.3`, and creates a GitHub release with the `.tgz` attached and the changelog section as
   notes.

   ```bash
   gh run watch
   ```

5. **Check the release.**

   ```bash
   npx clean-assets-meta@latest --version
   ```

## Releasing by hand

Pushing a tag still works and runs the same Release workflow:

```bash
scripts/changelog.sh release 1.2.3   # update CHANGELOG.md
git switch -c release/v1.2.3 && git commit -am "Release 1.2.3"
# open and merge the pull request, then on the merged main:
git tag -a v1.2.3 -m "clean-assets-meta 1.2.3"
git push origin v1.2.3
```

Don't push the tag for a `release/v*` pull request you merged: merging it already publishes.

## One-time setup

npm needs to trust the workflow before it can publish.

1. **First publish.** npm only lets you configure trusted publishing for a package that exists, so
   either publish `1.0.0` from your machine once:

   ```bash
   npm login
   npm version 1.0.0 --no-git-tag-version
   pnpm pack && npm publish clean-assets-meta-1.0.0.tgz --access public
   git checkout package.json
   ```

   then push the `v1.0.0` tag so the workflow creates the GitHub release (it skips the npm step
   for a version that's already published); or add an `NPM_TOKEN` secret (below) and let the
   workflow do the first publish too.

2. **Trusted publishing (recommended).** On npmjs.com, open the package's **Settings** →
   **Trusted Publisher**, choose GitHub Actions, and enter `dommangetnicolas`,
   `clean-assets-meta` and the workflow file `release.yml`. The workflow then publishes with a
   short-lived token, no secret needed, and npm shows where each version was built. Then set
   **Publishing access** to require two-factor authentication and disallow tokens.

3. **Or a token.** Create a granular access token on npmjs.com with read and write access to
   `clean-assets-meta` and add it as the `NPM_TOKEN` repository secret
   (**Settings** → **Secrets and variables** → **Actions**). Remove it once trusted publishing is
   set up.

Provenance needs the repository to be public.

## If something goes wrong

Each step of the Release workflow skips work that's already done (a version already on npm, a
tag that exists, a release that exists), so after fixing the cause you can **re-run the failed
job** from the Actions tab.

If the problem is in the code and nothing reached npm yet, fix it on `main`, then tag the fixed
commit (moving the tag if it was already pushed):

```bash
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3
git tag -a v1.2.3 -m "clean-assets-meta 1.2.3"
git push origin v1.2.3
```

A version published to npm can't be replaced: npm never accepts the same version twice, even
after `npm unpublish`. Ship the fix as the next patch version, and deprecate the broken one:

```bash
npm deprecate clean-assets-meta@1.2.3 "Broken, use 1.2.4"
```
