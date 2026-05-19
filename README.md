# Diagram App

Electron desktop app with a Next.js (App Router) UI, using **Bun** and **TypeScript**.

## Stack

- **Electron** — native window, system integration, preload bridge
- **Next.js 16** — React UI with App Router and Tailwind CSS
- **Bun** — package manager and script runner
- **TypeScript** — main process, preload, and renderer

## Project layout

```
electron/           # Main process & preload (compiled to dist-electron/)
src/app/            # Next.js pages and components
scripts/            # Build helpers (esbuild, copy standalone assets)
```

## Scripts

| Command | Description |
|--------|-------------|
| `bun run dev` | Start Next.js dev server and Electron (hot reload for UI) |
| `bun run build` | Production Next.js standalone build + Electron bundle |
| `bun run start` | Run the packaged Electron app (after `build`) |
| `bun run package` | Build Windows installer (unsigned; no admin symlinks needed) |
| `bun run package:dir` | Unpacked app only in `release/win-unpacked/` (faster) |

## Development

```bash
bun install
bun run dev
```

The Electron window loads `http://127.0.0.1:3000` while Next.js runs in dev mode.

If Electron’s binary was not downloaded on first install, run:

```bash
cd node_modules/electron && node install.js
```

## Production

`next build` uses `output: "standalone"`. The main process starts that server inside Electron (`ELECTRON_RUN_AS_NODE`) and loads it in the window.

## Packaging on Windows

`bun run package` skips code signing so electron-builder does not extract `winCodeSign` (that step needs symlink privileges on Windows). For signed releases, enable **Developer Mode** (Settings → System → For developers) or run the terminal as Administrator, then configure a code-signing certificate.

## Extending

- **UI**: edit `src/app/`
- **Native APIs**: add IPC in `electron/main.ts` and expose safe methods in `electron/preload.ts`
- **Types**: `src/types/electron.d.ts` for the renderer `window.electronAPI` shape
