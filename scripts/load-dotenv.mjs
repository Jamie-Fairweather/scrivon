import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const projectRoot = join(__dirname, '..')

/** @param {string} raw */
function parseValue(raw) {
    const quote = raw[0]
    if (quote === '"' || quote === "'") {
        const end = raw.indexOf(quote, 1)
        if (end !== -1) return raw.slice(1, end)
    }
    // Unquoted values end at an inline ` # comment`.
    return raw.replace(/\s+#.*$/, '')
}

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

        process.env[key] = parseValue(trimmed.slice(separator + 1).trim())
    }
}

/**
 * Resolves a key path from .env: `~` means the home folder, a relative path is
 * relative to the repo, and an absolute path is used as is.
 * @param {string} keyPath
 * @param {{ root?: string, home?: string }} [options]
 */
export function resolveKeyPath(keyPath, { root = projectRoot, home = homedir() } = {}) {
    const expanded = keyPath === '~' || /^~[\\/]/.test(keyPath) ? join(home, keyPath.slice(1)) : keyPath
    return resolve(root, expanded)
}

/**
 * Whether a Tauri CLI command signs anything with the updater key: `build`, `bundle` and `signer sign`.
 * `dev`, `info`, `signer generate` and the rest never use it.
 * @param {string[]} args the arguments after `tauri`
 */
export function tauriCommandSigns(args) {
    if (args.includes('--help') || args.includes('-h')) return false
    // Tauri's global flags (-v, -h, -V) take no value, so the first plain argument is the command.
    const [command, subcommand] = args.filter((arg) => !arg.startsWith('-'))
    return command === 'build' || command === 'bundle' || (command === 'signer' && subcommand === 'sign')
}

/**
 * @param {{ root?: string, home?: string, keyRequired?: boolean }} [options]
 * `keyRequired: false` (for commands that don't sign) turns a missing key file into a warning.
 */
export function applyTauriSigningFromEnv({ root = projectRoot, home = homedir(), keyRequired = true } = {}) {
    if (process.env.TAURI_SIGNING_PRIVATE_KEY) return

    const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
    if (keyPath) {
        const resolved = resolveKeyPath(keyPath, { root, home })
        // Never fall back to another key when a path was set: that could sign updates with the wrong key.
        if (!existsSync(resolved)) {
            const problem = `TAURI_SIGNING_PRIVATE_KEY_PATH points to a file that doesn't exist: ${resolved}`
            if (!keyRequired) {
                console.warn(`${problem}\nThis command doesn't sign anything, so it carries on without the key.`)
                return
            }
            throw new Error(`${problem}\n` + 'Fix the path (in .env or your environment), or remove it to use src-tauri/.updater/scrivon.')
        }
        process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(resolved, 'utf8').trim()
        return
    }

    const defaultKeyPath = join(root, 'src-tauri', '.updater', 'scrivon')
    if (existsSync(defaultKeyPath)) {
        process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(defaultKeyPath, 'utf8').trim()
    }
}
