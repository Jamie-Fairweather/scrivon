import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTauriSigningFromEnv, loadDotEnv, resolveKeyPath, tauriCommandSigns } from './load-dotenv.mjs'

const ENV_KEYS = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'DOTENV_TEST_A', 'DOTENV_TEST_B']

let dir: string
let root: string
let home: string
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scrivon-dotenv-'))
    root = join(dir, 'repo')
    home = join(dir, 'home')
    mkdirSync(root)
    mkdirSync(home)
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
    for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
    }
    rmSync(dir, { recursive: true, force: true })
})

function writeFile(path: string, contents: string) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
}

describe('resolveKeyPath', () => {
    it('resolves a relative path against the repo', () => {
        expect(resolveKeyPath('src-tauri/.updater/scrivon', { root, home })).toBe(join(root, 'src-tauri', '.updater', 'scrivon'))
    })

    it('keeps an absolute path as it is', () => {
        const absolute = join(dir, 'keys', 'scrivon.key')
        expect(resolveKeyPath(absolute, { root, home })).toBe(absolute)
    })

    it('expands ~ to the home folder', () => {
        expect(resolveKeyPath('~/.tauri/scrivon.key', { root, home })).toBe(join(home, '.tauri', 'scrivon.key'))
        expect(resolveKeyPath('~\\.tauri\\scrivon.key', { root, home })).toBe(join(home, '.tauri', 'scrivon.key'))
    })
})

describe('applyTauriSigningFromEnv', () => {
    it('loads the key from an absolute TAURI_SIGNING_PRIVATE_KEY_PATH', () => {
        const keyFile = join(dir, 'keys', 'scrivon.key')
        writeFile(keyFile, 'absolute-key\n')
        process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyFile

        applyTauriSigningFromEnv({ root, home })

        expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBe('absolute-key')
    })

    it('loads the key from a path relative to the repo', () => {
        writeFile(join(root, 'keys', 'scrivon'), 'relative-key')
        process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = 'keys/scrivon'

        applyTauriSigningFromEnv({ root, home })

        expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBe('relative-key')
    })

    it('fails instead of falling back to the default key when the path is missing', () => {
        writeFile(join(root, 'src-tauri', '.updater', 'scrivon'), 'stale-default-key')
        process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = join(dir, 'missing.key')

        expect(() => applyTauriSigningFromEnv({ root, home })).toThrow(
            `TAURI_SIGNING_PRIVATE_KEY_PATH points to a file that doesn't exist: ${join(dir, 'missing.key')}`
        )
        expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined()
    })

    it('only warns about a missing path for a command that does not sign', () => {
        writeFile(join(root, 'src-tauri', '.updater', 'scrivon'), 'stale-default-key')
        process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = join(dir, 'missing.key')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        try {
            expect(() => applyTauriSigningFromEnv({ root, home, keyRequired: false })).not.toThrow()
            expect(warn).toHaveBeenCalledWith(expect.stringContaining(join(dir, 'missing.key')))
            expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined()
        } finally {
            warn.mockRestore()
        }
    })

    it('uses the default key file only when no path is set', () => {
        writeFile(join(root, 'src-tauri', '.updater', 'scrivon'), 'default-key\n')

        applyTauriSigningFromEnv({ root, home })

        expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBe('default-key')
    })

    it('leaves a key that is already set alone', () => {
        process.env.TAURI_SIGNING_PRIVATE_KEY = 'from-env'
        process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = join(dir, 'missing.key')

        applyTauriSigningFromEnv({ root, home })

        expect(process.env.TAURI_SIGNING_PRIVATE_KEY).toBe('from-env')
    })
})

describe('tauriCommandSigns', () => {
    it.each([
        [['build'], true],
        [['build', '--bundles', 'nsis'], true],
        [['--verbose', 'build'], true],
        [['bundle'], true],
        [['signer', 'sign', 'file.exe'], true],
        [['build', '--help'], false],
        [['dev'], false],
        [['info'], false],
        [['signer', 'generate', '-w', 'src-tauri/.updater/scrivon'], false],
        [[], false],
    ])('%j signs: %s', (args, expected) => {
        expect(tauriCommandSigns(args)).toBe(expected)
    })
})

describe('loadDotEnv', () => {
    it('drops inline comments from unquoted values but keeps # inside quotes', () => {
        const envFile = join(dir, '.env')
        writeFile(
            envFile,
            [
                'TAURI_SIGNING_PRIVATE_KEY_PATH=C:\\keys\\scrivon.key # my key',
                'DOTENV_TEST_A="value # not a comment" # a comment',
                "DOTENV_TEST_B='quoted'",
            ].join('\r\n')
        )

        loadDotEnv(envFile)

        expect(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH).toBe('C:\\keys\\scrivon.key')
        expect(process.env.DOTENV_TEST_A).toBe('value # not a comment')
        expect(process.env.DOTENV_TEST_B).toBe('quoted')
    })
})
