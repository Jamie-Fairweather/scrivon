import { describe, expect, it } from 'vitest'
import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'

describe('getKeybindActionMeta', () => {
    it('returns metadata for known actions', () => {
        expect(getKeybindActionMeta('document.save').label).toBe('Save active document')
    })

    it('throws for unknown actions', () => {
        expect(() => getKeybindActionMeta('unknown.action' as 'document.save')).toThrow('Unknown keybind action')
    })
})
