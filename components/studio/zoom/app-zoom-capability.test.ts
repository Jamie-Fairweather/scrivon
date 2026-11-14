import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Capability = { windows?: string[]; permissions?: (string | { identifier: string })[] }

const CAPABILITIES_DIR = path.resolve(__dirname, '../../../src-tauri/capabilities')

// Without this permission setZoom is refused and AppZoom only logs a warning, so zooming would quietly do nothing.
describe('app zoom capability', () => {
    it('lets the main window zoom its page', () => {
        const granted = readdirSync(CAPABILITIES_DIR)
            .filter((name) => name.endsWith('.json'))
            .map((name) => JSON.parse(readFileSync(path.join(CAPABILITIES_DIR, name), 'utf8')) as Capability)
            .some(
                (cap) =>
                    cap.windows?.includes('main') &&
                    cap.permissions?.some((p) => (typeof p === 'string' ? p : p.identifier) === 'core:webview:allow-set-webview-zoom')
            )
        expect(granted).toBe(true)
    })
})
