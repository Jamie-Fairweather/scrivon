import { describe, expect, it } from 'vitest'
import { isPrereleaseVersion } from './version'

describe('isPrereleaseVersion', () => {
    it('is true for rc and beta builds only', () => {
        expect(isPrereleaseVersion('1.6.0-rc.1')).toBe(true)
        expect(isPrereleaseVersion('v2.0.0-beta')).toBe(true)
        expect(isPrereleaseVersion('1.6.0')).toBe(false)
        expect(isPrereleaseVersion('1.6.0+build-1')).toBe(false)
        expect(isPrereleaseVersion('nightly-1')).toBe(false)
    })
})
