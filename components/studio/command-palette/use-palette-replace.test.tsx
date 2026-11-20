import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordFileVersion } from '@/lib/tauri/file-history'
import { readWorkspaceTextFile, writeWorkspaceFile, type TextFileRead } from '@/lib/tauri/fs'
import { applyTextEdits, type TextEdit } from '@/lib/workspace/text-edits'
import type { DocumentTab } from '@/lib/workspace/types'
import { compileTextQuery, PLAIN_SEARCH_OPTIONS } from '@/components/studio/command-palette/text-matcher'
import type { TextPaletteItem } from '@/components/studio/command-palette/types'
import { usePaletteReplace, type UsePaletteReplaceOptions } from '@/components/studio/command-palette/use-palette-replace'

vi.mock('@/lib/tauri/fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/fs')>()),
    readWorkspaceTextFile: vi.fn(),
    writeWorkspaceFile: vi.fn(async () => null),
    readStamp: vi.fn(async () => null),
}))
vi.mock('@/lib/tauri/file-history', () => ({ recordFileVersion: vi.fn(async () => true) }))

const UTF8 = { encoding: 'utf-8' as const, bom: false }

/** Files on disk, as readWorkspaceTextFile gives them. */
let disk: Record<string, string> = {}

/**
 * The open tabs, changed only by applyTabEdits (as the editor changes them, one undo step). Replace is given
 * no other way to change a tab: it never calls updateTabContent, whose setValue would wipe the undo history.
 */
function workspace(tabs: DocumentTab[]) {
    const state = { tabs }
    const coordinator = {
        getTabs: { current: () => state.tabs },
        openFile: {
            current: vi.fn(async (path: string) => {
                if (disk[path] === undefined) return
                state.tabs = [...state.tabs, { id: path, path, name: path.split('/').pop()!, content: disk[path]!, isDirty: false, isSaving: false }]
            }),
        },
        applyTabEdits: {
            current: vi.fn((tabId: string, edits: readonly TextEdit[]) => {
                const tab = state.tabs.find((t) => t.id === tabId)
                if (!tab || tab.readOnly) return false
                state.tabs = state.tabs.map((t) => (t.id === tabId ? { ...t, content: applyTextEdits(t.content, edits), isDirty: true } : t))
                return true
            }),
        },
        fileSaved: { current: vi.fn() },
    }
    return { state, coordinator }
}

function tab(path: string, content: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content, isDirty: false, isSaving: false, ...extra }
}

function matcher(query: string) {
    const compiled = compileTextQuery(query, PLAIN_SEARCH_OPTIONS)
    if (!compiled.ok) throw new Error(compiled.error)
    return compiled.matcher
}

function hitAt(path: string, line: number, column: number, length: number): TextPaletteItem {
    const name = path.split('/').pop()!
    return {
        kind: 'text',
        value: `text:${path}:${line}:${column}`,
        searchText: name,
        path,
        name,
        relativePath: name,
        documentKind: 'markdown',
        line,
        column,
        length,
        preview: '',
        previewMatchStart: 0,
        previewMatchLength: length,
        source: 'disk',
        newText: 'dog',
    }
}

function setup(tabs: DocumentTab[], overrides: Partial<UsePaletteReplaceOptions> = {}) {
    const ws = workspace(tabs)
    const refresh = vi.fn()
    const view = renderHook(() =>
        usePaletteReplace({
            active: true,
            matcher: matcher('cat'),
            replacement: 'dog',
            filePaths: Object.keys(disk),
            refresh,
            queryKey: 'cat',
            coordinator: ws.coordinator as unknown as UsePaletteReplaceOptions['coordinator'],
            showEditor: vi.fn(),
            keepHistory: false,
            ...overrides,
        })
    )
    return { ...ws, refresh, ...view }
}

beforeEach(() => {
    disk = {}
    vi.mocked(readWorkspaceTextFile).mockImplementation(async (path: string): Promise<TextFileRead> => {
        if (disk[path] === undefined) throw new Error('not found (os error 2)')
        return { content: disk[path]!, format: UTF8, stamp: { size: disk[path]!.length, mtimeMs: 1 } }
    })
})

afterEach(() => {
    vi.clearAllMocks()
})

describe('usePaletteReplace, one match and one file', () => {
    it('replaces one match in an open tab with unsaved edits through applyTabEdits, never writing it', async () => {
        disk = { '/w/a.md': 'old text on disk' }
        const { result, state, coordinator, refresh } = setup([tab('/w/a.md', 'a cat and a cat', { isDirty: true })])

        await act(() => result.current.replaceMatch(hitAt('/w/a.md', 1, 13, 3)))

        expect(coordinator.applyTabEdits.current).toHaveBeenCalledTimes(1)
        expect(state.tabs[0]!.content).toBe('a cat and a dog')
        expect(writeWorkspaceFile).not.toHaveBeenCalled()
        expect(result.current.notice?.message).toBe('Replaced 1 match in a.md.')
        // The results are searched again, so the replaced match can't be replaced twice.
        expect(refresh).toHaveBeenCalled()
    })

    it('opens a file that is not open in a tab and changes it there, never on disk', async () => {
        disk = { '/w/b.md': 'cat' }
        const { result, state, coordinator } = setup([])

        await act(() => result.current.replaceMatch(hitAt('/w/b.md', 1, 1, 3)))

        expect(coordinator.openFile.current).toHaveBeenCalledWith('/w/b.md')
        expect(state.tabs.map((t) => [t.path, t.content, t.isDirty])).toEqual([['/w/b.md', 'dog', true]])
        expect(writeWorkspaceFile).not.toHaveBeenCalled()
    })

    it('finds the open tab however the folder listing spells its path', async () => {
        const { result, state, coordinator } = setup([tab('C:\\Notes\\A.md', 'cat')])

        await act(() => result.current.replaceFile('c:/notes/a.md'))

        expect(coordinator.openFile.current).not.toHaveBeenCalled()
        expect(state.tabs[0]!.content).toBe('dog')
    })

    it('replaces every match in the file and says how many, not how many were listed', async () => {
        const { result, state } = setup([tab('/w/a.md', 'cat '.repeat(25))])

        await act(() => result.current.replaceFile('/w/a.md'))

        expect(state.tabs[0]!.content).toBe('dog '.repeat(25))
        expect(result.current.notice?.message).toBe('Replaced 25 matches in a.md.')
    })

    it('leaves a read-only tab alone and says why', async () => {
        const { result, coordinator } = setup([tab('/w/a.md', 'cat', { readOnly: true })])

        await act(() => result.current.replaceFile('/w/a.md'))

        expect(coordinator.applyTabEdits.current).not.toHaveBeenCalled()
        expect(result.current.notice?.message).toBe('Nothing was replaced in a.md: it is open read-only.')
    })

    it('says so when the match has moved since it was found', async () => {
        const { result, coordinator } = setup([tab('/w/a.md', 'x cat')])

        await act(() => result.current.replaceMatch(hitAt('/w/a.md', 1, 1, 3)))

        expect(coordinator.applyTabEdits.current).not.toHaveBeenCalled()
        expect(result.current.notice?.message).toBe('That match in a.md has changed since it was found.')
    })

    it('does nothing for a result from an older search', async () => {
        const { result, coordinator } = setup([tab('/w/a.md', 'cat')])
        await act(() => result.current.replaceMatch({ ...hitAt('/w/a.md', 1, 1, 3), disabled: true }))
        expect(coordinator.applyTabEdits.current).not.toHaveBeenCalled()
    })
})

describe('usePaletteReplace, Replace All', () => {
    it('counts afresh, asks with the true totals, then writes closed files and changes open ones in their tabs', async () => {
        disk = { '/w/open.md': 'cat on disk', '/w/closed.md': 'cat\r\ncat', '/w/none.md': 'nothing' }
        const { result, state, coordinator, refresh } = setup([tab('/w/open.md', 'cat cat cat', { isDirty: true })], { keepHistory: true })

        await act(() => result.current.startReplaceAll())
        expect(result.current.replaceAll).toMatchObject({ phase: 'confirm', plan: { totalMatches: 5 } })
        expect(writeWorkspaceFile).not.toHaveBeenCalled()

        await act(() => result.current.confirmReplaceAll())

        // The open file, with unsaved edits, changes only in its tab.
        expect(state.tabs[0]!.content).toBe('dog dog dog')
        expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
        expect(writeWorkspaceFile).toHaveBeenCalledWith('/w/closed.md', 'dog\r\ndog', { format: UTF8, expected: { size: 8, mtimeMs: 1 } })
        // Its old text is kept in Local History first.
        expect(recordFileVersion).toHaveBeenCalledWith('/w/closed.md', 'cat\r\ncat', 'before-first-write')
        expect(coordinator.fileSaved.current).toHaveBeenCalledWith('/w/closed.md')
        expect(result.current.replaceAll).toEqual({ phase: 'idle' })
        expect(result.current.notice?.message).toBe('Replaced 5 matches in 2 files.')
        expect(refresh).toHaveBeenCalled()
    })

    it('replaces nothing when the question is turned down', async () => {
        disk = { '/w/a.md': 'cat' }
        const { result } = setup([])
        await act(() => result.current.startReplaceAll())
        act(() => result.current.cancelReplaceAll())
        expect(result.current.replaceAll).toEqual({ phase: 'idle' })
        expect(writeWorkspaceFile).not.toHaveBeenCalled()
    })

    it('stops before the next file once cancelled, keeping what was written, and says so', async () => {
        disk = { '/w/a.md': 'cat', '/w/b.md': 'cat', '/w/c.md': 'cat' }
        const { result } = setup([])
        await act(() => result.current.startReplaceAll())
        vi.mocked(writeWorkspaceFile).mockImplementationOnce(async () => {
            result.current.cancelReplaceAll()
            return null
        })

        await act(() => result.current.confirmReplaceAll())

        expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
        expect(result.current.notice?.message).toBe('Replace All stopped after 1 file of 3. Replaced 1 match.')
        expect(result.current.notice?.details).toEqual(['Already replaced in a.md.'])
    })

    it('says there is nothing to replace, and why files were left alone, without asking', async () => {
        disk = {}
        const { result } = setup([tab('/w/ro.md', 'cat', { readOnly: true })])
        await act(() => result.current.startReplaceAll())
        expect(result.current.replaceAll).toEqual({ phase: 'idle' })
        expect(result.current.notice?.message).toBe('Nothing was replaced.')
        expect(result.current.notice?.details).toEqual(['Skipped 1 file: ro.md (it is open read-only).'])
    })
})
