import { describe, expect, it } from 'vitest'
import { normalizePdfExportSettings } from '@/lib/settings/pdf-export-normalize'

describe('normalizePdfExportSettings repeated ids', () => {
    it("doesn't give a repeated id one that a later profile saved, so the active profile stays the same", () => {
        const normalized = normalizePdfExportSettings({
            profiles: [
                { id: 'a', name: 'First' },
                { id: 'a', name: 'Second' },
                { id: 'a-1', name: 'Third' },
            ],
            activeProfileId: 'a-1',
        })

        const ids = normalized.profiles.map((profile) => profile.id)
        expect(new Set(ids).size).toBe(3)
        expect(ids[0]).toBe('a')
        expect(ids[2]).toBe('a-1')
        expect(normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)?.name).toBe('Third')
    })

    it('skips every saved id when it picks a new one', () => {
        const normalized = normalizePdfExportSettings({
            profiles: [
                { id: 'a', name: 'First' },
                { id: 'a-2', name: 'Second' },
                { id: 'a', name: 'Third' },
                { id: 'a-3', name: 'Fourth' },
                { id: 'a', name: 'Fifth' },
            ],
            activeProfileId: 'a-3',
        })

        const ids = normalized.profiles.map((profile) => profile.id)
        expect(new Set(ids).size).toBe(5)
        expect(ids.slice(0, 2)).toEqual(['a', 'a-2'])
        expect(ids[3]).toBe('a-3')
        expect(normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)?.name).toBe('Fourth')
    })
})
