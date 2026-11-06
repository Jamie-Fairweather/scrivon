import { describe, expect, it } from 'vitest'
import { tabFromFile, tabWithRecoveredText } from './document-tab'

describe('tabWithRecoveredText', () => {
    const backup = {
        path: 'C:\\ws\\notes.md',
        root: 'C:\\ws',
        content: 'typed before the crash',
        format: { encoding: 'utf-8' as const, bom: false },
        stamp: { mtimeMs: 10, size: 4 },
        savedAt: 1,
    }

    it('puts the kept text in the tab, unsaved, tied to the version of the file it was typed on', () => {
        const fromDisk = tabFromFile('C:\\ws\\notes.md', {
            content: 'disk',
            format: { encoding: 'utf-16le', bom: true },
            stamp: { mtimeMs: 99, size: 9 },
        })

        expect(tabWithRecoveredText(fromDisk, backup)).toEqual({
            id: 'C:\\ws\\notes.md',
            path: 'C:\\ws\\notes.md',
            name: 'notes.md',
            content: 'typed before the crash',
            isDirty: true,
            isSaving: false,
            format: { encoding: 'utf-8', bom: false },
            disk: { stamp: { mtimeMs: 10, size: 4 } },
        })
    })

    it('makes the text editable again, and builds a tab when the file is gone', () => {
        const readOnly = tabFromFile('C:\\ws\\notes.md', {
            content: 'Caf\u00e9',
            format: { encoding: 'utf-8', bom: false },
            issue: 'legacy-encoding',
            stamp: null,
        })
        expect(tabWithRecoveredText(readOnly, backup)).not.toHaveProperty('readOnly')
        expect(tabWithRecoveredText(readOnly, backup)).not.toHaveProperty('encodingIssue')

        expect(tabWithRecoveredText(null, { ...backup, format: undefined })).toMatchObject({
            id: 'C:\\ws\\notes.md',
            content: 'typed before the crash',
            isDirty: true,
            disk: { stamp: { mtimeMs: 10, size: 4 } },
        })
    })
})
