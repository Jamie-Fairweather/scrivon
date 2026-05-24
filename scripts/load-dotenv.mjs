import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const projectRoot = join(__dirname, '..')

/** @param {string} [envPath] */
export function loadDotEnv(envPath = join(projectRoot, '.env')) {
    if (!existsSync(envPath)) return

    const contents = readFileSync(envPath, 'utf8')
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const separator = trimmed.indexOf('=')
        if (separator === -1) continue

        const key = trimmed.slice(0, separator).trim()
        if (!key || process.env[key] !== undefined) continue

        let value = trimmed.slice(separator + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }

        process.env[key] = value
    }
}

export function applyTauriSigningFromEnv() {
    const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY && keyPath) {
        const resolved = join(projectRoot, keyPath)
        if (existsSync(resolved)) {
            process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(resolved, 'utf8').trim()
        }
    }

    const defaultKeyPath = join(projectRoot, 'src-tauri', '.updater', 'scrivon')
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(defaultKeyPath)) {
        process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(defaultKeyPath, 'utf8').trim()
    }
}
