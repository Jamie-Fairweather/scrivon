import { describe, expect, it } from 'vitest'
import { formatFileSize, LARGE_FILE_BYTES, tabFromFile, tabWithRecoveredText } from './document-tab'

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

describe('very large files', () => {
    const read = (size: number) => ({ content: 'x', format: { encoding: 'utf-8' as const, bom: false }, stamp: { mtimeMs: 1, size } })

    it('opens a file over 5 MB read-only, and leaves smaller ones editable', () => {
        expect(tabFromFile('/ws/log.md', read(LARGE_FILE_BYTES + 1))).toMatchObject({ readOnly: true, largeFile: true })
        expect(tabFromFile('/ws/notes.md', read(LARGE_FILE_BYTES))).not.toHaveProperty('readOnly')
        expect(tabFromFile('/ws/unknown.md', { ...read(0), stamp: null })).not.toHaveProperty('largeFile')
    })

    it('writes sizes the way people read them', () => {
        expect(formatFileSize(6.2 * 1024 * 1024)).toBe('6.2 MB')
        expect(formatFileSize(23.4 * 1024 * 1024)).toBe('23 MB')
        expect(formatFileSize(300)).toBe('1 KB')
        expect(formatFileSize(40 * 1024)).toBe('40 KB')
    })
})
