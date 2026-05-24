import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyTauriSigningFromEnv, loadDotEnv, projectRoot } from './load-dotenv.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tauriBin = join(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

loadDotEnv()
applyTauriSigningFromEnv()

const args = process.argv.slice(2)
if (args.length === 0) {
    console.error('Usage: bun run tauri <command> [args...]')
    process.exit(1)
}

if (!existsSync(tauriBin)) {
    console.error('Tauri CLI is not installed. Run bun install first.')
    process.exit(1)
}

const result = spawnSync(process.execPath, [tauriBin, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
})

process.exit(result.status ?? 1)
