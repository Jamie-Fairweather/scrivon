# Scrivon

[![Version](https://img.shields.io/github/v/release/Jamie-Fairweather/scrivon?label=version)](https://github.com/Jamie-Fairweather/scrivon/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows)](https://github.com/Jamie-Fairweather/scrivon/releases/latest)

**Mermaid & markdown on your machine.**

Scrivon is a desktop editor for [Mermaid](https://mermaid.js.org/) diagrams. Open a folder on disk, edit `.mmd` files with syntax highlighting, and preview diagrams live on the canvas — no account, no cloud workspace required.

<p align="center">
  <img src="preview.png" alt="Scrivon — workspace, Monaco editor, and live Mermaid preview" width="900" />
</p>

## Features

- **Folder workspaces** — Open any directory on disk; your files never leave your machine
- **File explorer** — Create, rename, duplicate, and delete `.mmd` / `.mermaid` files and folders from the sidebar
- **Split editor + preview** — [Monaco](https://microsoft.github.io/monaco-editor/) editor with syntax highlighting beside a live-rendered diagram canvas
- **Multi-tab editing** — Work across several diagrams in one session; tab state is restored per workspace
- **Canvas tools** — Pan and zoom the preview, fit diagram to screen, or switch to preview-only layout
- **Export** — Save the active diagram as SVG or PNG (1×, 2×, or 4×)
- **Built-in examples** — Curated sample diagrams to explore Mermaid syntax and layouts
- **Themes** — Light and dark UI plus 15+ diagram palettes (Scrivon, Zinc, Tokyo Night, Catppuccin, Nord, Dracula, GitHub, Solarized, One Dark, and more)
- **Autosave** — Optional autosave to disk; **Ctrl/Cmd+S** saves immediately
- **Recent folders** — Quick access from the welcome screen and **File → Open Recent**
- **Desktop-native** — Built with [Tauri 2](https://v2.tauri.app/) for a fast, local-first experience on Windows
- **Auto-updates** — Stable releases can update in-app (see [releases](https://github.com/Jamie-Fairweather/scrivon/releases))

> Scrivon is an independent editor. It is not affiliated with Mermaid Chart Inc. or the mermaid-js project.

## Download

Pre-built installers are published on **[GitHub Releases](https://github.com/Jamie-Fairweather/scrivon/releases)**.

| Channel     | Branch | Notes                                                |
| ----------- | ------ | ---------------------------------------------------- |
| Stable      | `main` | Recommended for everyday use; in-app updates enabled |
| Pre-release | `rc`   | Test builds; install manually from Releases          |

## Getting started

### Use a release

1. Download the latest installer from [Releases](https://github.com/Jamie-Fairweather/scrivon/releases).
2. Launch Scrivon and choose **Open Folder**.
3. Select a directory containing `.mmd` (or compatible) diagram files.
4. Edit in the center pane; the preview updates as you type.

### Build from source

**Prerequisites:** [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and platform dependencies for [Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/Jamie-Fairweather/scrivon.git
cd scrivon
bun install
bun run tauri dev
```

For release builds, signing keys, branch workflow, and semantic-release setup, see **[docs/development.md](docs/development.md)**.

## Tech stack

| Layer             | Technologies                                                       |
| ----------------- | ------------------------------------------------------------------ |
| Desktop shell     | [Tauri 2](https://v2.tauri.app/) (Rust)                            |
| UI                | [Next.js](https://nextjs.org/), [React 19](https://react.dev/)     |
| Editor            | [Monaco](https://microsoft.github.io/monaco-editor/)               |
| Diagram rendering | [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) |
| Styling           | [Tailwind CSS](https://tailwindcss.com/)                           |

## Project layout

```
scrivon/
├── app/                 # Next.js app routes
├── components/studio/   # Editor, canvas, workspace UI
├── lib/                 # Mermaid, workspace, Tauri helpers
├── src-tauri/           # Tauri / Rust backend
├── scripts/             # Build and codegen utilities
└── docs/                # Maintainer documentation
```

## Contributing

Contributions are welcome. Please open an issue to discuss larger changes before submitting a pull request.

1. Fork the repository and create a branch from `dev` (or `main` for small fixes).
2. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.) so releases can be automated.
3. Run `bun run tauri dev` locally to verify desktop behavior.
4. Open a pull request with a clear description of the change.

See **[docs/development.md](docs/development.md)** for the full release pipeline, branch model, and updater signing.

## Acknowledgments

- [Mermaid](https://mermaid.js.org/) for the diagram syntax
- Example diagrams adapted from [Craft Mermaid samples](https://agents.craft.do/mermaid)
- UI built with [coss](https://coss.com/ui) / Base UI primitives

## License

Scrivon is released under the [MIT License](LICENSE). Third-party dependencies are listed in-app under **Help → Licences**.

## Links

- [Releases](https://github.com/Jamie-Fairweather/scrivon/releases)
- [Development & releases guide](docs/development.md)
- [Report an issue](https://github.com/Jamie-Fairweather/scrivon/issues)
