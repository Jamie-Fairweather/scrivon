# Development & releases

This guide covers local development, IDE setup, semantic versioning, branch workflow, and updater signing for maintainers.

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

```bash
bun install
bun run tauri dev
```

The web UI also runs with `bun run dev`, but folder workspaces require the desktop app (`bun run tauri dev`).

## Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) and [Conventional Commits](https://www.conventionalcommits.org/).

### Branches

| Branch | Purpose                                            | Example version |
| ------ | -------------------------------------------------- | --------------- |
| `main` | Stable releases                                    | `0.2.0`         |
| `rc`   | Pre-releases (GitHub Release marked as prerelease) | `0.2.0-rc.1`    |

Push to `main` or `rc` when commits since the last tag warrant a version bump. The release workflow bumps versions, updates the changelog, creates a git tag and GitHub Release, then builds Windows installers and uploads them to that release.

| Release type                          | Windows assets                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Stable (`main`, e.g. `1.0.0`)         | `.msi` + `.exe` (NSIS)                                                       |
| Pre-release (`rc`, e.g. `1.0.0-rc.1`) | `.exe` only — WiX/MSI does not support semver pre-release labels like `rc.1` |

To rebuild installers for an existing tag (e.g. `v1.0.0`), run **Actions → Build release artifacts (manual)** and enter the tag name.

### Commit messages

Use these prefixes so semantic-release can determine the next version:

- `fix:` — patch (e.g. `0.1.0` → `0.1.1`)
- `feat:` — minor (e.g. `0.1.0` → `0.2.0`)
- `feat!:` or a `BREAKING CHANGE:` footer — major (e.g. `0.1.0` → `1.0.0`)
- `chore:`, `docs:`, `refactor:`, etc. — no release by themselves (unless they include breaking change markers)

Examples:

```
feat: add diagram export
fix: prevent canvas flash on theme change
feat!: remove legacy file format support
```

### Bootstrap (first automated release)

1. Create an `rc` branch on GitHub from `main` if you want pre-releases.
2. Optionally tag the current state so the first run only considers newer commits:

    ```bash
    git tag v0.1.0
    git push origin v0.1.0
    ```

    Without this tag, existing `feat:` commits in history may produce a larger first bump (e.g. `0.2.0`).

3. Merge a conventional commit to `main` or `rc` and confirm the [Release](../.github/workflows/release.yml) and [Build release artifacts](../.github/workflows/build-release.yml) workflows succeed.

### Branch model

| Branch | Purpose                                                       |
| ------ | ------------------------------------------------------------- |
| `dev`  | Day-to-day development                                        |
| `rc`   | Pre-releases (`1.0.0-rc.1`, …) — push here to test installers |
| `main` | Stable releases only                                          |

Create `rc` **from** `main`, not the other way around. Do **not** delete `main` and recreate it from `rc` — that copies the rc version (`1.0.0-rc.x` in `package.json`) and the `chore(release): …` commit from the rc line onto stable.

### Promoting rc → stable (main)

When rc is ready to ship:

1. Open a PR **rc → main** (or merge locally).
2. Use **Create a merge commit** on GitHub (not fast-forward). That makes a new commit on `main` and triggers the Release workflow.
3. semantic-release on `main` publishes the next **stable** version (from commits since the last stable tag) and the Windows build job runs.

Fast-forwarding `main` to match `rc` tip still works now that release commits no longer use `[skip ci]`, but a merge commit is clearer in history.

### Fix main after recreating it from rc

If `main` currently matches `rc` (wrong version in `package.json`, no Release run):

```bash
git fetch origin
git checkout main
git reset --hard v1.0.0          # last stable tag on main (adjust if yours differs)
git merge origin/rc --no-ff -m "chore: promote rc to stable"
git push origin main
```

Review the diff before pushing. If `v1.0.0` already exists, the next stable release is usually a **minor** bump (e.g. `1.1.0`) because of `feat:` commits since that tag — not re-publishing `1.0.0`.

### Branch protection

If `main` or `rc` require pull requests, allow `github-actions[bot]` to bypass rules (or use a PAT in `GH_TOKEN`) so semantic-release can push the version bump commit.

### In-app updates

Stable releases only. The desktop app checks [latest stable `latest.json`](https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json) shortly after launch. Pre-release builds (e.g. `1.0.0-rc.1`) do not check for updates — install a new rc build from GitHub Releases manually.

### Generate updater signing keys

In-app updates require a minisign keypair. Do this once per machine (or again if you rotate keys).

1. **Generate the keypair** (no password — press Enter if prompted, or use `--ci` to skip prompts):

    ```bash
    bun tauri signer generate -w src-tauri/.updater/scrivon --ci -f
    ```

    Creates:
    - `src-tauri/.updater/scrivon` — private key (**never commit**; gitignored)
    - `src-tauri/.updater/scrivon.pub` — public key

2. **Update the public key in config** — copy the full contents of `scrivon.pub` into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (one line, no line breaks). Commit only this change to the public key, not the private key.

3. **Use the private key locally and in CI**
    - **Local:** copy [`.env.example`](../.env.example) to `.env` and set `TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/.updater/scrivon` (see [Local builds with signing](#local-builds-with-signing) below).
    - **CI:** add [repository secrets](#github-secrets-for-updater-signing) (not Environment secrets).

If you regenerate keys, repeat all three steps. Existing installs signed with the old key will not trust updates signed with the new key.

### GitHub secrets for updater signing

Under **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret                               | Value                                         |
| ------------------------------------ | --------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Full contents of `src-tauri/.updater/scrivon` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Leave empty if the key has no password        |

### Local builds with signing

The Tauri CLI does not read `.env` itself. This project wraps it so `bun run tauri build` loads [`.env`](../.env) first. Copy [`.env.example`](../.env.example) to `.env` and set either:

- `TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/.updater/scrivon` (recommended), or
- `TAURI_SIGNING_PRIVATE_KEY` with the full key contents.

If neither is set but `src-tauri/.updater/scrivon` exists, that file is used automatically.

### Code signing (optional)

Installers build unsigned by default. To sign releases later, add repository secrets for Tauri signing (Windows) and Apple notarization (macOS) per the [Tauri distribution docs](https://v2.tauri.app/distribute/sign/).
