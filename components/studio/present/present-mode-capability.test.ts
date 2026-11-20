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

function mainWindowMay(permission: string): boolean {
    return capabilities().some(
        (cap) => cap.windows?.includes('main') && cap.permissions?.some((p) => (typeof p === 'string' ? p : p.identifier) === permission)
    )
}

// Without these, setFullscreen and isFullscreen are refused and present mode only logs a warning, so the slides would
// quietly stop filling the screen.
describe('present mode capability', () => {
    it('lets the main window go full screen and back', () => {
        expect(mainWindowMay('core:window:allow-set-fullscreen')).toBe(true)
    })

    it('lets the main window ask whether it is full screen already', () => {
        expect(mainWindowMay('core:window:allow-is-fullscreen')).toBe(true)
    })
})
