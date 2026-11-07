import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '..')

function permissions(): string[] {
    const capability = JSON.parse(readFileSync(join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8')) as { permissions: unknown[] }
    return capability.permissions.filter((p): p is string => typeof p === 'string')
}

function appSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return appSourceFiles(path)
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : []
    })
}

/** The functions app code imports from @tauri-apps/plugin-fs (types left out). */
function importedFsFunctions(): Set<string> {
    const names = new Set<string>()
    const pattern = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*'@tauri-apps\/plugin-fs'/g
    for (const file of ['app', 'components', 'hooks', 'lib'].flatMap((dir) => appSourceFiles(join(repoRoot, dir)))) {
        for (const [, typeOnly, list] of readFileSync(file, 'utf8').matchAll(pattern)) {
            if (typeOnly) continue
            for (const part of list!.split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0]
                if (name && !name.startsWith('type ')) names.add(name)
            }
        }
    }
    return names
}

/**
 * The plugin command permissions a plugin-fs function needs, by its name (readDir needs fs:allow-read-dir).
 * writeFile also opens the file and writes in parts when given a stream; the app only passes bytes.
 */
function permissionsFor(name: string): string[] {
    if (name === 'watch' || name === 'watchImmediate') return ['fs:allow-watch', 'fs:allow-unwatch']
    return [`fs:allow-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`]
}

describe('file system grants', () => {
    it('allow only the file commands the app calls, not every read and write command (S13)', () => {
        const granted = permissions()
        for (const broad of ['fs:read-all', 'fs:write-all', 'fs:read-meta', 'fs:read-files', 'fs:write-files', 'fs:read-dirs']) {
            expect(granted).not.toContain(broad)
        }

        const needed = [...new Set([...importedFsFunctions()].flatMap(permissionsFor))].sort()
        const fsCommands = granted.filter((p) => p.startsWith('fs:allow-')).sort()
        // A missing one fails in the app with "not allowed"; an extra one is access nothing uses.
        expect(fsCommands).toEqual(needed)
    })

    it('finds the app’s file calls, and keeps the plugin’s defaults', () => {
        // Guards the check above against finding nothing (a moved file, say) and so asking for nothing.
        expect(importedFsFunctions().has('readFile')).toBe(true)
        expect(permissions()).toContain('fs:default')
    })
})
