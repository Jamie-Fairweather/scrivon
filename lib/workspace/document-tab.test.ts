import { describe, expect, it } from 'vitest'
import {
    anySavedTabs,
    anyTabsToRight,
    dropIndexAt,
    formatFileSize,
    indexAfterDrop,
    LARGE_FILE_BYTES,
    moveItem,
    tabFromFile,
    tabFromPath,
    tabMovedMessage,
    tabWithRecoveredText,
} from './document-tab'

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

describe('tab checks for the close actions', () => {
    const tabs = [tabFromPath('/ws/a.md', ''), { ...tabFromPath('/ws/b.md', ''), isDirty: true }, tabFromPath('/ws/c.md', '')]

    it('finds tabs to the right of a tab, but not of the last one or one not open', () => {
        expect(anyTabsToRight(tabs, '/ws/a.md')).toBe(true)
        expect(anyTabsToRight(tabs, '/ws/b.md')).toBe(true)
        expect(anyTabsToRight(tabs, '/ws/c.md')).toBe(false)
        expect(anyTabsToRight(tabs, '/ws/gone.md')).toBe(false)
        expect(anyTabsToRight(tabs, null)).toBe(false)
    })

    it('finds a saved tab only when one has no unsaved changes', () => {
        expect(anySavedTabs(tabs)).toBe(true)
        expect(anySavedTabs(tabs.map((t) => ({ ...t, isDirty: true })))).toBe(false)
        expect(anySavedTabs([])).toBe(false)
    })
})

describe('moveItem', () => {
    const list = ['a', 'b', 'c', 'd']

    it('moves an item so it ends up at the index given', () => {
        expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
        expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
        expect(moveItem(list, 1, 2)).toEqual(['a', 'c', 'b', 'd'])
        // The list given is left as it was.
        expect(list).toEqual(['a', 'b', 'c', 'd'])
    })

    it('keeps the index inside the list', () => {
        expect(moveItem(list, 1, 99)).toEqual(['a', 'c', 'd', 'b'])
        expect(moveItem(list, 2, -5)).toEqual(['c', 'a', 'b', 'd'])
    })

    it('hands back the same list when nothing moves', () => {
        expect(moveItem(list, 2, 2)).toBe(list)
        expect(moveItem(list, 3, 10)).toBe(list)
        expect(moveItem(list, 0, -1)).toBe(list)
        expect(moveItem(list, -1, 2)).toBe(list)
        expect(moveItem(list, 4, 0)).toBe(list)
    })
})

describe('dropIndexAt', () => {
    // Three tabs, 100px wide, side by side from x = 50.
    const rects = [
        { left: 50, width: 100 },
        { left: 150, width: 100 },
        { left: 250, width: 100 },
    ]

    it('lands before the first tab whose middle is to the right of the pointer', () => {
        expect(dropIndexAt(60, rects)).toBe(0)
        expect(dropIndexAt(99, rects)).toBe(0)
        expect(dropIndexAt(100, rects)).toBe(1)
        expect(dropIndexAt(180, rects)).toBe(1)
        expect(dropIndexAt(220, rects)).toBe(2)
    })

    it('lands at the end past the middle of the last tab, and at the start left of every tab', () => {
        expect(dropIndexAt(320, rects)).toBe(3)
        expect(dropIndexAt(900, rects)).toBe(3)
        expect(dropIndexAt(0, rects)).toBe(0)
    })

    it('lands at the start of an empty strip', () => {
        expect(dropIndexAt(100, [])).toBe(0)
        expect(dropIndexAt(100, [], { left: 0, right: 300 })).toBe(0)
    })

    describe('in a strip that scrolls', () => {
        // Six tabs, 100px wide from x = -100, in a strip that shows 0 to 300: tab 0 is off to the left,
        // tabs 3 to 5 off to the right.
        const overflowing = Array.from({ length: 6 }, (_, i) => ({ left: -100 + i * 100, width: 100 }))
        const visible = { left: 0, right: 300 }

        it('counts a pointer beside the strip as at its nearest edge', () => {
            // Over the Export and Fit buttons on the right: not among the tabs scrolled out of view.
            expect(dropIndexAt(360, overflowing)).toBe(5)
            expect(dropIndexAt(360, overflowing, visible)).toBe(3)
            expect(dropIndexAt(900, overflowing, visible)).toBe(3)
            // Over the layout buttons on the left.
            expect(dropIndexAt(-60, overflowing)).toBe(0)
            expect(dropIndexAt(-60, overflowing, visible)).toBe(1)
        })

        it('only lands in a gap whose line can be seen', () => {
            // Past the middle of tab 3, whose right edge (the gap before tab 4) is right at the strip's edge.
            expect(dropIndexAt(260, overflowing, visible)).toBe(3)
            expect(dropIndexAt(240, overflowing, visible)).toBe(3)
            expect(dropIndexAt(140, overflowing, visible)).toBe(2)
            // The gap before tab 1 is at the strip's left edge, so it can be seen.
            expect(dropIndexAt(10, overflowing, visible)).toBe(1)
        })

        it('works as without it when the tabs fit', () => {
            const wide = { left: 0, right: 600 }
            for (const x of [-20, 60, 99, 100, 180, 220, 320, 900]) {
                expect(dropIndexAt(x, rects, wide)).toBe(dropIndexAt(Math.max(x, 0), rects))
            }
            // The end of the last tab, with empty strip after it.
            expect(dropIndexAt(500, rects, wide)).toBe(3)
        })
    })
})

describe('indexAfterDrop', () => {
    it('turns the gap a tab is let go in into its index once it has moved', () => {
        // Tab 1 of four dropped in the gap before tab 3 ends up at index 2.
        expect(indexAfterDrop(1, 3)).toBe(2)
        expect(indexAfterDrop(1, 4)).toBe(3)
        expect(indexAfterDrop(2, 0)).toBe(0)
    })

    it('leaves a tab dropped either side of itself where it was', () => {
        expect(indexAfterDrop(1, 1)).toBe(1)
        expect(indexAfterDrop(1, 2)).toBe(1)
    })
})

describe('tabMovedMessage', () => {
    it('says where the tab went, counting from one', () => {
        expect(tabMovedMessage('notes.md', 1, 4)).toBe('notes.md moved to position 2 of 4')
    })
})
