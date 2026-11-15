import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Capability = { windows?: string[]; permissions?: (string | { identifier: string })[] }

const ROOT = path.resolve(__dirname, '../..')
const CAPABILITIES_DIR = path.join(ROOT, 'src-tauri', 'capabilities')

/** Every permission the main window is given, across the capability files. */
function mainWindowPermissions(): string[] {
    return readdirSync(CAPABILITIES_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(path.join(CAPABILITIES_DIR, name), 'utf8')) as Capability)
        .filter((capability) => capability.windows?.includes('main'))
        .flatMap((capability) => (capability.permissions ?? []).map((p) => (typeof p === 'string' ? p : p.identifier)))
}

/** The functions lib/tauri/clipboard.ts imports from the clipboard plugin, the only file that may. */
function importedClipboardFunctions(): string[] {
    const source = readFileSync(path.join(ROOT, 'lib', 'tauri', 'clipboard.ts'), 'utf8')
    const list = source.match(/import\s+\{([^}]*)\}\s*from\s*'@tauri-apps\/plugin-clipboard-manager'/)?.[1] ?? ''
    return list
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
}

describe('clipboard grants', () => {
    it('allow only the clipboard commands the app calls', () => {
        // readText needs clipboard-manager:allow-read-text, and so on.
        const needed = importedClipboardFunctions()
            .map((name) => `clipboard-manager:allow-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`)
            .sort()
        const granted = mainWindowPermissions()
            .filter((p) => p.startsWith('clipboard-manager:'))
            .sort()

        // A missing one fails in the app with "not allowed"; an extra one (clear, write-html) is access nothing uses.
        expect(granted).toEqual(needed)
        expect(needed).toEqual([
            'clipboard-manager:allow-read-image',
            'clipboard-manager:allow-read-text',
            'clipboard-manager:allow-write-image',
            'clipboard-manager:allow-write-text',
        ])
    })

    it('let a pasted picture be read: its pixels and size, and letting it go', () => {
        // Part of core:default (core:image:default and core:resources:default).
        expect(mainWindowPermissions()).toContain('core:default')
    })
})
