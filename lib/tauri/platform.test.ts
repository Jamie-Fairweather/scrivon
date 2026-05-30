import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauri, isWindowsTauri } from './platform'

describe('isTauri', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns false when window is undefined', () => {
        vi.stubGlobal('window', undefined)
        expect(isTauri()).toBe(false)
    })

    it('returns false in a normal browser environment', () => {
        expect(isTauri()).toBe(false)
    })

    it('returns true when Tauri internals are present', () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
        expect(isTauri()).toBe(true)
    })
})

describe('isWindowsTauri', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('returns false outside Tauri', () => {
        expect(isWindowsTauri()).toBe(false)
    })

    it('returns false when navigator is unavailable', () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
        vi.stubGlobal('navigator', undefined)
        expect(isWindowsTauri()).toBe(false)
    })

    it('detects Windows user agents inside Tauri', () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })
        expect(isWindowsTauri()).toBe(true)
    })

    it('returns false for non-Windows user agents inside Tauri', () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })
        expect(isWindowsTauri()).toBe(false)
    })
})
