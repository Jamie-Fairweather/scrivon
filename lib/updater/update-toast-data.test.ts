import { describe, expect, it, vi } from 'vitest'
import { APP_UPDATE_TOAST_VARIANT, isAppUpdateToastData } from './update-toast-data'

describe('isAppUpdateToastData', () => {
    it('accepts valid app update toast data', () => {
        const data = { variant: APP_UPDATE_TOAST_VARIANT, onView: vi.fn() }
        expect(isAppUpdateToastData(data)).toBe(true)
    })

    it('rejects invalid shapes', () => {
        expect(isAppUpdateToastData(null)).toBe(false)
        expect(isAppUpdateToastData({ variant: 'other', onView: vi.fn() })).toBe(false)
        expect(isAppUpdateToastData({ variant: APP_UPDATE_TOAST_VARIANT, onView: 'nope' })).toBe(false)
    })
})
