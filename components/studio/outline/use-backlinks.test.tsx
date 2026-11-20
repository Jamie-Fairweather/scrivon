import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readStamp } from '@/lib/tauri/fs'
import { BACKLINKS_DELAY_MS } from '@/lib/workspace/backlinks'
import { notifyWorkspaceDiskChange } from '@/lib/workspace/disk-changes'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'
import { useBacklinks, type BacklinksState } from './use-backlinks'

const ROOT = 'C:\\notes'
const GUIDE = `${ROOT}\\guide.md`
const OTHER = `${ROOT}\\other.md`

const workspace = vi.hoisted(() => ({
    tabs: [] as DocumentTab[],
    tree: [] as FileNode[],
    workspaceRoot: 'C:\\notes' as string | null,
    disk: {} as Record<string, string>,
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs: workspace.tabs }),
    useWorkspaceSession: () => ({ workspaceRoot: workspace.workspaceRoot, tree: workspace.tree }),
}))

vi.mock('@/lib/tauri/fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/fs')>()),
    readWorkspaceFile: vi.fn(async (path: string) => workspace.disk[path] ?? ''),
    // Changes with the text, as a file's size and time would.
    readStamp: vi.fn(async (path: string) => ({ mtimeMs: (workspace.disk[path] ?? '').length, size: (workspace.disk[path] ?? '').length })),
}))

function tab(path: string, content: string): DocumentTab {
    return { id: path, path, name: path.split('\\').pop()!, content, isDirty: false, isSaving: false }
}

const file = (path: string): FileNode => ({ kind: 'file', name: path.split('\\').pop()!, path })

/** The links listed, as `note:line`, or the state's kind while there is no list. */
function listed(state: BacklinksState): string[] | string {
    return state.kind === 'ready' ? state.result.links.map((link) => `${link.relative}:${link.line}`) : state.kind
}

describe('useBacklinks', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        // The test DOM has no workers, so the notes are read on the main thread.
        vi.stubGlobal('Worker', undefined)
        workspace.tree = [file(GUIDE), file(OTHER)]
        workspace.workspaceRoot = ROOT
        workspace.disk = { [OTHER]: 'See [[guide]].' }
        workspace.tabs = [tab(GUIDE, '# Guide')]
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    const settle = () => act(() => vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS))

    it('lists the links once changes pause, and again after an unsaved edit in a tab or a change on disk', async () => {
        const { result, rerender } = renderHook(({ active }) => useBacklinks(active), { initialProps: { active: workspace.tabs[0]! } })
        expect(listed(result.current)).toBe('loading')
        await settle()
        expect(listed(result.current)).toEqual(['other:1'])

        // Open, with a second link not saved yet: the tab's text counts.
        workspace.tabs = [tab(GUIDE, '# Guide'), tab(OTHER, 'See [[guide]].\n\nAnd [[Guide#Top]].')]
        rerender({ active: workspace.tabs[0]! })
        await settle()
        expect(listed(result.current)).toEqual(['other:1', 'other:3'])

        // Closed again, and changed on disk by another app.
        workspace.tabs = [tab(GUIDE, '# Guide')]
        workspace.disk = { [OTHER]: 'No links any more.' }
        rerender({ active: workspace.tabs[0]! })
        await settle()
        expect(listed(result.current)).toEqual([])

        workspace.disk = { [OTHER]: 'Back: [[guide]]' }
        act(() => notifyWorkspaceDiskChange())
        await settle()
        expect(listed(result.current)).toEqual(['other:1'])
    })

    it('doesn’t scan for typing in the file itself, and doesn’t ask the disk again for typing in another note', async () => {
        const THIRD = `${ROOT}\\third.md`
        workspace.tree = [file(GUIDE), file(OTHER), file(THIRD)]
        workspace.disk = { [OTHER]: 'See [[guide]].', [THIRD]: 'Nothing.' }
        workspace.tabs = [tab(GUIDE, '# Guide'), tab(THIRD, 'Nothing.')]
        const { result, rerender } = renderHook(({ active }) => useBacklinks(active), { initialProps: { active: workspace.tabs[0]! } })
        await settle()
        expect(listed(result.current)).toEqual(['other:1'])
        const stats = vi.mocked(readStamp).mock.calls.length
        const ready = result.current.kind === 'ready' && result.current.result

        // Typing in the file showing: its own links never count, so nothing is worked out again.
        workspace.tabs = [tab(GUIDE, '# Guide\n\nMore [[guide]]'), workspace.tabs[1]!]
        rerender({ active: workspace.tabs[0]! })
        await settle()
        expect(result.current.kind === 'ready' && result.current.result).toBe(ready)
        expect(readStamp).toHaveBeenCalledTimes(stats)

        // Typing in another note: that tab is read again, the note on disk isn't stamped again.
        workspace.tabs = [workspace.tabs[0]!, tab(THIRD, 'Now [[guide]].')]
        rerender({ active: workspace.tabs[0]! })
        await settle()
        expect(listed(result.current)).toEqual(['other:1', 'third:1'])
        expect(readStamp).toHaveBeenCalledTimes(stats)

        // A change on disk asks again.
        act(() => notifyWorkspaceDiskChange())
        await settle()
        expect(readStamp).toHaveBeenCalledTimes(stats + 1)
    })

    it('never shows another file’s list, and says when there is no folder or no Markdown file', async () => {
        const { result, rerender } = renderHook(({ active }) => useBacklinks(active), {
            initialProps: { active: workspace.tabs[0]! as DocumentTab | null },
        })
        await settle()
        expect(listed(result.current)).toEqual(['other:1'])

        rerender({ active: tab(OTHER, 'See [[guide]].') })
        expect(listed(result.current)).toBe('loading')
        await settle()
        expect(listed(result.current)).toEqual([])

        rerender({ active: tab('D:\\loose\\x.md', '') })
        expect(listed(result.current)).toBe('no-folder')
        rerender({ active: tab(`${ROOT}\\chart.mmd`, '') })
        expect(listed(result.current)).toBe('none')
        rerender({ active: null })
        expect(listed(result.current)).toBe('none')
    })
})
