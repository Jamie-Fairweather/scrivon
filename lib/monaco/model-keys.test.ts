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

function paths(tabs: DocumentTab[]): string[] {
    return tabs.map((t) => t.path)
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

    it('keeps the key of a file moved into another folder', () => {
        const newKey = counter()
        const prev = [tab('/w/a.md'), tab('/w/b.md')]
        const before = syncModelKeys(EMPTY_MODEL_KEYS, paths(prev), newKey)
        const after = syncModelKeys(before, paths(remapTabsAfterRename(prev, '/w/a.md', '/w/archive/a.md', 'a.md')), newKey)
        expect(after.keys.get('/w/archive/a.md')).toBe('key-1')
        expect(after.keys.get('/w/b.md')).toBe('key-2')
    })

    it('keeps the keys of a moved file and of the tabs left in its old folder', () => {
        const newKey = counter()
        const prev = [tab('/w/notes/a.md'), tab('/w/notes/b.md')]
        const before = syncModelKeys(EMPTY_MODEL_KEYS, paths(prev), newKey)
        const after = syncModelKeys(before, paths(remapTabsAfterRename(prev, '/w/notes/a.md', '/w/archive/a.md', 'a.md')), newKey)
        expect([...after.keys.entries()]).toEqual([
            ['/w/archive/a.md', 'key-1'],
            ['/w/notes/b.md', 'key-2'],
        ])
    })

    it('keeps the keys of every open file inside a moved folder', () => {
        const newKey = counter()
        const prev = [tab('C:\\w\\docs\\a.md'), tab('C:\\w\\top.md'), tab('C:\\w\\docs\\sub\\b.md')]
        const before = syncModelKeys(EMPTY_MODEL_KEYS, paths(prev), newKey)
        const after = syncModelKeys(before, paths(remapTabsAfterRename(prev, 'C:\\w\\docs', 'C:\\w\\old\\docs', 'docs')), newKey)
        expect([...after.keys.entries()]).toEqual([
            ['C:\\w\\old\\docs\\a.md', 'key-1'],
            ['C:\\w\\top.md', 'key-2'],
            ['C:\\w\\old\\docs\\sub\\b.md', 'key-3'],
        ])
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

    it('finds nothing when no tab changed', () => {
        expect(detectRenamedPaths(['/w/a.md'], ['/w/a.md']).size).toBe(0)
        expect(detectRenamedPaths([], []).size).toBe(0)
    })

    it('ignores tabs being opened, closed or replaced', () => {
        expect(detectRenamedPaths(['/w/a.md'], ['/w/a.md', '/w/b.md']).size).toBe(0)
        expect(detectRenamedPaths(['/w/a.md', '/w/b.md'], ['/w/b.md']).size).toBe(0)
        // Swapped order is not a rename.
        expect(detectRenamedPaths(['/w/a.md', '/w/b.md'], ['/w/b.md', '/w/a.md']).size).toBe(0)
        // Changes in different places are not one rename.
        expect(detectRenamedPaths(['/w/x/a.md', '/w/y/b.md'], ['/w/x/c.md', '/w/z/b.md']).size).toBe(0)
        // Files that keep their names but end up in different folders did not move together.
        expect(detectRenamedPaths(['/w/x/a.md', '/w/x/b.md'], ['/w/y/a.md', '/w/z/b.md']).size).toBe(0)
    })

    it('rejects a folder move that leaves one of its tabs behind', () => {
        expect(detectRenamedPaths(['/w/docs/a.md', '/w/docs/b.md', '/w/docs/c.md'], ['/w/notes/a.md', '/w/notes/b.md', '/w/docs/c.md']).size).toBe(0)
    })

    it('matches what remapTabsAfterRename does when a file moves and gets a new name to avoid a clash', () => {
        const prev = [tab('/w/notes/a.md'), tab('/w/notes/b.md')]
        const next = remapTabsAfterRename(prev, '/w/notes/a.md', '/w/archive/a (1).md', 'a (1).md')
        expect(detectRenamedPaths(paths(prev), paths(next))).toEqual(new Map([['/w/archive/a (1).md', '/w/notes/a.md']]))
    })
})

describe('normalizeEditorText', () => {
    it('matches how Monaco stores text', () => {
        expect(normalizeEditorText('\uFEFFa\r\nb\rc\n')).toBe('a\nb\nc\n')
    })
})

describe('model keys for file names with percent signs', () => {
    it('gives files whose names differ only by a %XX code their own buffer', async () => {
        // Monaco reads a model path with URI.parse, which decodes %XX: a raw file path would make
        // 'a b.md' and 'a%20b.md' share one buffer.
        const { URI } = await import('monaco-editor/base/common/uri.js')
        expect(URI.parse('C:\\w\\a b.md').toString()).toBe(URI.parse('C:\\w\\a%20b.md').toString())

        const paths = ['C:\\w\\a b.md', 'C:\\w\\a%20b.md', '/w/100%.md', '/w/100%25.md', '/w/50%41.md', '/w/50A.md']
        const state = syncModelKeys(EMPTY_MODEL_KEYS, paths)
        const uris = paths.map((path) => URI.parse(state.keys.get(path)!).toString())
        expect(new Set(uris).size).toBe(paths.length)
    })
})
