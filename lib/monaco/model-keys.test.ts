import { describe, expect, it } from 'vitest'
import { remapTabsAfterRename } from '@/lib/workspace/tab-paths'
import type { DocumentTab } from '@/lib/workspace/types'
import { EMPTY_MODEL_KEYS, MODEL_KEY_PREFIX, createModelKey, detectRenamedPaths, isModelKey, normalizeEditorText, syncModelKeys } from './model-keys'

function counter() {
    let n = 0
    return () => `key-${++n}`
}

function tab(path: string): DocumentTab {
    return { id: path, path, name: path.split(/[/\\]/).pop()!, content: '', isDirty: false, isSaving: false }
}

describe('createModelKey', () => {
    it('never repeats a key', () => {
        const a = createModelKey()
        const b = createModelKey()
        expect(a).not.toBe(b)
        expect(isModelKey(a)).toBe(true)
        expect(a.startsWith(MODEL_KEY_PREFIX)).toBe(true)
        expect(isModelKey('file:///C:/w/a.md')).toBe(false)
    })
})

describe('syncModelKeys', () => {
    it('gives each open tab its own key and keeps keys for tabs that stay open', () => {
        const newKey = counter()
        const first = syncModelKeys(EMPTY_MODEL_KEYS, ['/w/a.md', '/w/b.md'], newKey)
        expect([...first.keys.entries()]).toEqual([
            ['/w/a.md', 'key-1'],
            ['/w/b.md', 'key-2'],
        ])

        const second = syncModelKeys(first, ['/w/a.md', '/w/b.md', '/w/c.md'], newKey)
        expect(second.keys.get('/w/a.md')).toBe('key-1')
        expect(second.keys.get('/w/c.md')).toBe('key-3')
    })

    it('returns the same state when the tab paths did not change', () => {
        const state = syncModelKeys(EMPTY_MODEL_KEYS, ['/w/a.md'], counter())
        expect(syncModelKeys(state, ['/w/a.md'], counter())).toBe(state)
    })

    it('gives a file a new key when its tab is closed and opened again', () => {
        const newKey = counter()
        const open = syncModelKeys(EMPTY_MODEL_KEYS, ['/w/a.md', '/w/b.md'], newKey)
        const closed = syncModelKeys(open, ['/w/b.md'], newKey)
        expect(closed.keys.has('/w/a.md')).toBe(false)

        const reopened = syncModelKeys(closed, ['/w/b.md', '/w/a.md'], newKey)
        expect(reopened.keys.get('/w/a.md')).not.toBe(open.keys.get('/w/a.md'))
        expect(reopened.keys.get('/w/b.md')).toBe(open.keys.get('/w/b.md'))
    })

    it('keeps the key of a renamed file', () => {
        const newKey = counter()
        const before = syncModelKeys(EMPTY_MODEL_KEYS, ['C:\\w\\a.md', 'C:\\w\\b.md'], newKey)
        const after = syncModelKeys(before, ['C:\\w\\c.md', 'C:\\w\\b.md'], newKey)
        expect(after.keys.get('C:\\w\\c.md')).toBe(before.keys.get('C:\\w\\a.md'))
        expect(after.keys.has('C:\\w\\a.md')).toBe(false)
    })

    it('gives a new key when a file is deleted and another with the same name is created', () => {
        const newKey = counter()
        const open = syncModelKeys(EMPTY_MODEL_KEYS, ['/w/a.md'], newKey)
        const deleted = syncModelKeys(open, [], newKey)
        const recreated = syncModelKeys(deleted, ['/w/a.md'], newKey)
        expect(recreated.keys.get('/w/a.md')).not.toBe(open.keys.get('/w/a.md'))
    })
})

describe('detectRenamedPaths', () => {
    it('matches what remapTabsAfterRename does for a file', () => {
        const prev = [tab('/w/a.md'), tab('/w/b.md')]
        const next = remapTabsAfterRename(prev, '/w/a.md', '/w/z.md', 'z.md')
        expect(
            detectRenamedPaths(
                prev.map((t) => t.path),
                next.map((t) => t.path)
            )
        ).toEqual(new Map([['/w/z.md', '/w/a.md']]))
    })

    it('matches what remapTabsAfterRename does for a folder', () => {
        const prev = [tab('C:\\w\\docs\\a.md'), tab('C:\\w\\top.md'), tab('C:\\w\\docs\\sub\\b.md')]
        const next = remapTabsAfterRename(prev, 'C:\\w\\docs', 'C:\\w\\notes', 'notes')
        expect(
            detectRenamedPaths(
                prev.map((t) => t.path),
                next.map((t) => t.path)
            )
        ).toEqual(
            new Map([
                ['C:\\w\\notes\\a.md', 'C:\\w\\docs\\a.md'],
                ['C:\\w\\notes\\sub\\b.md', 'C:\\w\\docs\\sub\\b.md'],
            ])
        )
    })

    it('ignores tabs being opened, closed or replaced', () => {
        expect(detectRenamedPaths(['/w/a.md'], ['/w/a.md', '/w/b.md']).size).toBe(0)
        expect(detectRenamedPaths(['/w/a.md', '/w/b.md'], ['/w/b.md']).size).toBe(0)
        // Swapped order is not a rename.
        expect(detectRenamedPaths(['/w/a.md', '/w/b.md'], ['/w/b.md', '/w/a.md']).size).toBe(0)
        // Changes in different places are not one rename.
        expect(detectRenamedPaths(['/w/x/a.md', '/w/y/b.md'], ['/w/x/c.md', '/w/z/b.md']).size).toBe(0)
        // A different depth is not a rename.
        expect(detectRenamedPaths(['/w/a.md'], ['/w/sub/a.md']).size).toBe(0)
    })

    it('rejects a folder "rename" that leaves one of its tabs behind', () => {
        expect(detectRenamedPaths(['/w/docs/a.md', '/w/docs/b.md'], ['/w/notes/a.md', '/w/docs/b.md']).size).toBe(0)
    })
})

describe('normalizeEditorText', () => {
    it('matches how Monaco stores text', () => {
        expect(normalizeEditorText('\uFEFFa\r\nb\rc\n')).toBe('a\nb\nc\n')
    })
})
