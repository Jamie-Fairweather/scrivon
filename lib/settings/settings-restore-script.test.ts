import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'

/**
 * The script the window runs before the page loads (`restore_script` in src-tauri/src/settings_file.rs),
 * filled in for the saved copy `text` the way Rust's format! does it.
 */
function restoreScript(text: string): string {
    const rust = readFileSync(path.resolve(__dirname, '../../src-tauri/src/settings_file.rs'), 'utf8')
    const body = rust.slice(rust.indexOf('pub fn restore_script'))
    const template = /format!\(\s*"([^"\\]*)"\s*\)/.exec(body)?.[1]
    if (!template) throw new Error('restore_script has no format! template')
    const values: Record<string, string> = { key: JSON.stringify(SETTINGS_STORAGE_KEY), copy: JSON.stringify(text) }
    return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (match, name?: string) => (name ? values[name]! : match[0]!))
}

/** Runs the script in a page whose localStorage holds `stored`. */
function run(script: string, stored: Map<string, string>, { framed = false, blocked = false } = {}): void {
    const page: { top?: unknown } = {}
    page.top = framed ? {} : page
    const localStorage = {
        getItem: (key: string) => {
            if (blocked) throw new Error('The operation is insecure.')
            return stored.get(key) ?? null
        },
        setItem: (key: string, value: string) => void stored.set(key, value),
    }
    // Runs the script Rust builds, as the window would.
    new Function('window', 'localStorage', script)(page, localStorage)
}

const COPY = '{\n  "theme": {"id": "scrivon-light"},\n  "note": "</script> \\" \' \\\\ \u2028"\n}'

describe('the start-up settings restore script', () => {
    it('puts the saved copy back when localStorage has no settings', () => {
        const stored = new Map<string, string>()

        run(restoreScript(COPY), stored)

        expect(stored.get(SETTINGS_STORAGE_KEY)).toBe(COPY)
    })

    it('leaves settings that are already there alone', () => {
        const stored = new Map([[SETTINGS_STORAGE_KEY, '{"theme":{"id":"scrivon-dark"}}']])

        run(restoreScript(COPY), stored)

        expect(stored.get(SETTINGS_STORAGE_KEY)).toBe('{"theme":{"id":"scrivon-dark"}}')
    })

    it('does nothing inside a frame', () => {
        const stored = new Map<string, string>()

        run(restoreScript(COPY), stored, { framed: true })

        expect(stored.size).toBe(0)
    })

    it("doesn't throw when storage is blocked", () => {
        expect(() => run(restoreScript(COPY), new Map(), { blocked: true })).not.toThrow()
    })
})
