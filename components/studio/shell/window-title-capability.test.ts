import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Capability = { windows?: string[]; permissions?: (string | { identifier: string })[] }

const CAPABILITIES_DIR = path.resolve(__dirname, '../../../src-tauri/capabilities')

function capabilities(): Capability[] {
    return readdirSync(CAPABILITIES_DIR)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(path.join(CAPABILITIES_DIR, name), 'utf8')) as Capability)
}

// Without this permission setTitle is refused and useNativeWindowTitle only logs a warning,
// so the taskbar title would quietly stop following the open file.
describe('window title capability', () => {
    it('lets the main window set its title', () => {
        const granted = capabilities().some(
            (cap) =>
                cap.windows?.includes('main') &&
                cap.permissions?.some((p) => (typeof p === 'string' ? p : p.identifier) === 'core:window:allow-set-title')
        )
        expect(granted).toBe(true)
    })
})
