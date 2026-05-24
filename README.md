# Scrivon

A Tauri desktop app for diagram editing, built with Next.js and React.

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

```bash
bun install
bun run tauri dev
```

## Releasing

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) and [Conventional Commits](https://www.conventionalcommits.org/).

### Branches

| Branch | Purpose                                            | Example version |
| ------ | -------------------------------------------------- | --------------- |
| `main` | Stable releases                                    | `0.2.0`         |
| `rc`   | Pre-releases (GitHub Release marked as prerelease) | `0.2.0-rc.1`    |

Push to `main` or `rc` when commits since the last tag warrant a version bump. The release workflow bumps versions, updates the changelog, creates a git tag and GitHub Release, then builds Windows installers and uploads them to that release.

| Release type | Windows assets |
|--------------|----------------|
| Stable (`main`, e.g. `1.0.0`) | `.msi` + `.exe` (NSIS) |
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

3. Merge a conventional commit to `main` or `rc` and confirm the [Release](.github/workflows/release.yml) and [Build release artifacts](.github/workflows/build-release.yml) workflows succeed.

### Branch protection

If `main` or `rc` require pull requests, allow `github-actions[bot]` to bypass rules (or use a PAT in `GH_TOKEN`) so semantic-release can push the version bump commit.

### Code signing (optional)

Installers build unsigned by default. To sign releases later, add repository secrets for Tauri signing (Windows) and Apple notarization (macOS) per the [Tauri distribution docs](https://v2.tauri.app/distribute/sign/).
