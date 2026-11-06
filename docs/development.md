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

Push to `main` or `rc` when commits since the last tag warrant a version bump. The release workflow first runs the same checks as a pull request ([`ci.yml`](../.github/workflows/ci.yml)) and stops if any fail. Then it bumps versions, updates the changelog, and creates a git tag and a **draft** GitHub Release. The Windows job builds the installers, uploads them and `latest.json` to the draft, and publishes it as its last step. Until then the release is hidden, so the download link and the updater never see a release without installers.

If the Windows build fails, the release stays a draft. Fix the cause, then re-run the failed job or run **Actions → Build release artifacts (manual)** with the tag. Either one publishes the draft when it finishes.

Stable and pre-releases ship one installer, `Scrivon_<version>_x64-setup.exe` (NSIS), plus its `.sig` and `latest.json` for the updater. It installs for the current user, with no admin prompt. There is no `.msi` any more: it installed a second, per-machine copy next to the setup `.exe` one, and the download counts show no one used it. `bundle.targets` in [`tauri.conf.json`](../src-tauri/tauri.conf.json) and the `--bundles nsis` in both release workflows keep it that way; the WiX settings stay pinned in case an MSI is ever needed again.

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

3. Merge a conventional commit to `main` or `rc` and confirm the [Release](../.github/workflows/release.yml) workflow succeeds: all three of its jobs (**CI checks**, **semantic-release** and **Build Windows installers**). The manual **Build release artifacts** workflow only runs when you start it.

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

If `main` or `rc` require pull requests, the Release workflow uses the `RELEASE_BOT_TOKEN` secret (a fine-grained or classic PAT) so semantic-release can push the `chore(release): …` commit. It also uses the token to comment on and label the pull requests and issues in each release; without **Issues** and **Pull requests** write access it quietly skips those comments. Add the **PAT owner** to the branch ruleset bypass list. The workflow is configured in [`.github/workflows/release.yml`](../.github/workflows/release.yml).

### In-app updates

Stable releases only. The desktop app checks [latest stable `latest.json`](https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json) shortly after launch. Pre-release builds (e.g. `1.0.0-rc.1`) do not check for updates — install a new rc build from GitHub Releases manually.

### Installer identity

The installers find an existing install through these values in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json): `productName`, `mainBinaryName`, `identifier`, `bundle.publisher` and `bundle.windows.wix.upgradeCode`. The `identifier` also names the folder where settings are kept. Don't change them. In 1.4.1 a new identifier silently changed the publisher from `diagram` to `github`, so updates lost track of installs in a custom folder and left the old copy behind. [`src-tauri/windows/installer-hooks.nsh`](../src-tauri/windows/installer-hooks.nsh) cleans that up; if one of these values ever has to change, add the same kind of clean-up there first.

That is why **Settings → Apps** and the exe's **Properties → Details** still name the publisher `github`. A real name needs more than a hook: the setup `.exe` reads the install folder, and the folder the old copy's uninstaller runs in, from `HKCU\Software\<publisher>\Scrivon` before any hook runs, so it would need a custom NSIS template (`bundle.windows.nsis.template`) that also checks the old key. The other bundle details (`copyright`, `homepage`, descriptions) are safe to change.

The setup `.exe` shows `src-tauri/windows/nsis-sidebar.bmp` on its welcome and finish pages and `nsis-header.bmp` at the top of the others. If you redraw them, keep them 24-bit BMPs at 164 × 314 and 150 × 57 pixels.

### Updater signing key

Updates are signed with a minisign key. Every installed copy only accepts updates signed with the private key that matches `plugins.updater.pubkey` in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json).

**There is one key for the project, made once.** Never make a new key for a new machine. If the private key is lost or replaced, no installed copy can update itself again, and every user has to download and reinstall Scrivon by hand.

#### Setting up a new machine

A local `bun run tauri build` needs the private key, because it signs the updater files. Copy the existing key; don't generate one, and don't touch `tauri.conf.json`.

1. Get the private key file (and its password, if it has one) from the password manager or the offline backup.
2. Save it as `src-tauri/.updater/scrivon`. Everything in `src-tauri/.updater/` except `.pub` files is gitignored, but **never commit it**, and keep backups of old keys outside the repository.
3. Copy [`.env.example`](../.env.example) to `.env` and set `TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/.updater/scrivon` (see [Local builds with signing](#local-builds-with-signing) below).

#### Creating the key (new project only)

Only if the project has no key yet, for example in a fork.

1. **Generate the keypair** and set a password when asked. Without `-f`, the command refuses to overwrite an existing key:

    ```bash
    bun tauri signer generate -w src-tauri/.updater/scrivon
    ```

    Creates:
    - `src-tauri/.updater/scrivon` — private key (**never commit**; gitignored)
    - `src-tauri/.updater/scrivon.pub` — public key

2. **Back up the private key and its password straight away**: in a password manager and in an offline copy (for example an encrypted USB stick).

3. **Put the public key in config** — copy the full contents of `scrivon.pub` into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (one line, no line breaks). Commit only this change to the public key, not the private key.

4. **Add the CI secrets** — see [GitHub Actions secrets](#github-actions-secrets) (repository secrets, not Environment secrets).

#### Changing the key (only if it leaks)

Installed copies only trust the old key, so a change takes two releases:

1. Generate a new keypair **outside the repository** (for example `bun tauri signer generate -w ~/scrivon-new.key`) and back it up.
2. Put the new public key in `tauri.conf.json` and ship a release that is still signed with the **old** key (leave the CI secrets alone). Copies that install this release now trust the new key.
3. Once most users have that release, switch the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets and your local `src-tauri/.updater/scrivon` to the new key.

Anyone who skips the release from step 2 has to reinstall by hand.

### GitHub Actions secrets

Under **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret                               | Value                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `RELEASE_BOT_TOKEN`                  | PAT on this repo with **Contents**, **Issues** and **Pull requests** (read/write); owner on bypass list |
| `TAURI_SIGNING_PRIVATE_KEY`          | Full contents of `src-tauri/.updater/scrivon`                                                           |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The key's password (leave empty only if the key has none)                                               |

### Local builds with signing

The Tauri CLI does not read `.env` itself. This project wraps it so `bun run tauri build` loads [`.env`](../.env) first. Copy [`.env.example`](../.env.example) to `.env` and set either:

- `TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/.updater/scrivon` (recommended), or
- `TAURI_SIGNING_PRIVATE_KEY` with the full key contents.

If the key has a password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. If neither key variable is set but `src-tauri/.updater/scrivon` exists, that file is used automatically.

`TAURI_SIGNING_PRIVATE_KEY_PATH` can be relative to the repo, absolute (`C:\Users\me\.tauri\scrivon.key`), or start with `~` for your home folder. If the file isn't there, the command stops with an error instead of quietly using a different key.

**Building without the key.** `bundle.createUpdaterArtifacts` is on, so `bun run tauri build` fails at the end, after building the installers, when there is no private key. Without the key you can still build installers; they just can't be offered as in-app updates:

```bash
bun run tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

### Windows code signing

The installers and `scrivon.exe` are **not** code-signed (Authenticode) yet. The `TAURI_SIGNING_*` secrets above only sign updates for the in-app updater, and Windows ignores that signature. Until releases are signed:

- SmartScreen shows **Windows protected your PC** on first install, and users have to click **More info**, then **Run anyway**.
- PCs with Smart App Control turned on block Scrivon completely.

There is no macOS build, so there is nothing to notarize.

Adding secrets alone does nothing. Signing needs a signing service, a Tauri config change and a CI change:

1. **Pick a signing service.** For example:
    - [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/): low monthly cost and works on GitHub runners. Check it is open to you first; it isn't available to individual developers in every country.
    - [SignPath Foundation](https://signpath.org/): free for open-source projects, but signing goes through their own GitHub Action.
    - A code-signing certificate from a certificate authority (Certum sells a cheap one for open-source developers).

2. **Add the signing settings in a separate file**, `src-tauri/tauri.signing.conf.json`, so local builds without the credentials still work. Don't call it `tauri.windows.conf.json`: Tauri merges that file into every Windows build automatically. For Trusted Signing:

    ```json
    {
        "bundle": {
            "windows": {
                "signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <certificate-profile> -d Scrivon %1"
            }
        }
    }
    ```

    For a certificate instead, set `certificateThumbprint`, `digestAlgorithm` (`sha256`) and `timestampUrl` in the same place, and import the certificate on the runner before the build.

3. **Use it in CI**, in both [`release.yml`](../.github/workflows/release.yml) and [`build-release.yml`](../.github/workflows/build-release.yml):
    - add a step before **Build and upload installers** that installs the tool (`cargo install trusted-signing-cli --locked`);
    - add the `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID` secrets to that step's `env`;
    - add `--config src-tauri/tauri.signing.conf.json` to its `args` (the path is relative to the repo root, where `bun run tauri` runs).

    Tauri then signs `scrivon.exe`, the installer plugins, the uninstaller and the setup `.exe`.

4. **Check a release**: right-click a downloaded installer → **Properties** → **Digital Signatures**, or run `signtool verify /pa <file>`. SmartScreen still needs time to trust a newly signed app, but that trust now carries over from release to release.

See the [Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/) for details.
