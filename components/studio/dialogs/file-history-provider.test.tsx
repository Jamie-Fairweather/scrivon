import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileVersion } from '@/lib/tauri/file-history'
import { applyTextEdits, type TextEdit } from '@/lib/workspace/text-edits'
import type { DocumentTab } from '@/lib/workspace/types'

const state = vi.hoisted(() => ({
    tabs: [] as DocumentTab[],
    activeTabId: null as string | null,
    historyEnabled: true,
    /** What the app keeps, newest first, and each version's text. */
    versions: [] as FileVersion[],
    texts: new Map<string, string>(),
    calls: [] as string[],
}))

const coordinator = vi.hoisted(() => ({
    release: vi.fn(),
    holdSaves: { current: vi.fn() },
    applyTabEdits: { current: vi.fn() },
}))

const setActiveTab = vi.hoisted(() => vi.fn())

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabActions: () => ({ setActiveTab }),
    useDocumentTabs: () => ({ tabs: state.tabs }),
    useWorkspaceCoordinator: () => coordinator,
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { fileHistory: { enabled: state.historyEnabled }, editor: { fontSize: 13, lineNumbers: 'on' } } }),
}))

vi.mock('@/lib/tauri/file-history', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/file-history')>()),
    listFileVersions: vi.fn(async () => {
        state.calls.push('list')
        return state.versions
    }),
    readFileVersion: vi.fn(async (_path: string, id: string) => state.texts.get(id) ?? ''),
    recordFileVersion: vi.fn(async () => {
        state.calls.push('record')
        return true
    }),
}))

// Monaco's diff editor has nothing to draw into here; what it is given is what counts.
vi.mock('@/components/studio/dialogs/file-history-diff', () => ({
    FileHistoryDiff: (props: { original: string; modified: string; originalLabel: string }) => (
        <div data-testid="diff" data-original={props.original} data-modified={props.modified} aria-label={props.originalLabel} />
    ),
}))

vi.mock('@/components/studio/editor/editor-focus', () => ({ focusEditorNow: vi.fn(() => true) }))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(),
}))

const { FileHistoryProvider, describeVersion, useFileHistory } = await import('./file-history-provider')
const { focusEditorNow } = await import('@/components/studio/editor/editor-focus')
const { recordFileVersion } = await import('@/lib/tauri/file-history')
const { notifyError } = await import('@/lib/notify')
const { isTauri } = await import('@/lib/tauri/platform')

const A = 'C:\\ws\\a.md'
const B = 'C:\\ws\\b.md'
const MINUTE = 60_000
const NOW = Date.UTC(2026, 10, 19, 14, 30)

function tab(path: string, content: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: path, path, name: path.split('\\').pop()!, content, isDirty: false, isSaving: false, ...extra }
}

function version(n: number, kind: FileVersion['kind'], text: string): FileVersion {
    const id = String(n).repeat(32).slice(0, 32)
    state.texts.set(id, text)
    return { id, createdMs: NOW - n * MINUTE, savedMs: NOW - n * MINUTE, size: text.length, kind }
}

function Opener({ tabId }: { tabId: string }) {
    const { showFileHistory } = useFileHistory()
    return (
        <button type="button" onClick={() => void showFileHistory(tabId)}>
            History of {tabId}
        </button>
    )
}

/** Lets the dialog finish opening or closing, and the versions load. */
const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
    })

async function openHistory(tabId = A) {
    render(
        <FileHistoryProvider>
            <Opener tabId={tabId} />
        </FileHistoryProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: `History of ${tabId}` }))
    await settle()
    return screen.getByRole('dialog')
}

const options = (dialog: HTMLElement) => within(dialog).getAllByRole('option')
const selectedOption = (dialog: HTMLElement) => options(dialog).find((option) => option.getAttribute('aria-selected') === 'true')

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(true)
    state.historyEnabled = true
    state.texts.clear()
    state.calls = []
    state.tabs = [tab(A, 'the text now'), tab(B, 'b now')]
    state.activeTabId = A
    state.versions = [version(1, 'autosave', 'autosaved text'), version(2, 'manual', 'saved text'), version(3, 'before-first-write', 'on disk')]
    setActiveTab.mockImplementation(async (id: string) => {
        state.calls.push(`activate ${id}`)
        state.activeTabId = id
    })
    coordinator.holdSaves.current.mockImplementation(async () => {
        state.calls.push('hold')
        return coordinator.release
    })
    coordinator.release.mockImplementation(() => state.calls.push('release'))
    coordinator.applyTabEdits.current.mockImplementation(() => {
        state.calls.push('edit')
        return true
    })
})

describe('describeVersion', () => {
    it('gives the time it was saved, its size and why it was kept', () => {
        const { time, details } = describeVersion({ id: 'x', createdMs: NOW, savedMs: NOW, size: 4200, kind: 'before-overwrite' })
        expect(time).toMatch(/2026/)
        expect(details).toBe('4 KB · Saved by another program')
    })
})

describe('File History', () => {
    it('makes a background tab the active one first, then lists its versions newest first', async () => {
        const dialog = await openHistory(B)

        expect(state.calls.slice(0, 2)).toEqual([`activate ${B}`, 'list'])
        expect(within(dialog).getByRole('heading', { name: 'File History: b.md' })).toBeInTheDocument()
        const listbox = within(dialog).getByRole('listbox', { name: 'Saved versions' })
        expect(options(dialog).map((option) => option.textContent)).toEqual(
            state.versions.map((v) => {
                const { time, details } = describeVersion(v)
                return `${time}${details}`
            })
        )
        // The list has the keyboard, with the newest version picked.
        expect(listbox).toHaveFocus()
        expect(listbox).toHaveAttribute('aria-activedescendant', selectedOption(dialog)!.id)
        expect(selectedOption(dialog)).toBe(options(dialog)[0])
    })

    it('moves through the versions with the arrow keys, Home and End, comparing each with the editor’s text', async () => {
        const dialog = await openHistory()
        const listbox = within(dialog).getByRole('listbox')
        const diff = () => within(dialog).getByTestId('diff')

        await waitFor(() => expect(diff()).toHaveAttribute('data-original', 'autosaved text'))
        expect(diff()).toHaveAttribute('data-modified', 'the text now')

        fireEvent.keyDown(listbox, { key: 'ArrowDown' })
        expect(selectedOption(dialog)).toBe(options(dialog)[1])
        await waitFor(() => expect(diff()).toHaveAttribute('data-original', 'saved text'))
        expect(listbox).toHaveAttribute('aria-activedescendant', options(dialog)[1]!.id)

        fireEvent.keyDown(listbox, { key: 'End' })
        expect(selectedOption(dialog)).toBe(options(dialog)[2])
        await waitFor(() => expect(diff()).toHaveAttribute('data-original', 'on disk'))
        fireEvent.keyDown(listbox, { key: 'ArrowDown' })
        expect(selectedOption(dialog)).toBe(options(dialog)[2])

        fireEvent.keyDown(listbox, { key: 'ArrowUp' })
        expect(selectedOption(dialog)).toBe(options(dialog)[1])
        fireEvent.keyDown(listbox, { key: 'Home' })
        expect(selectedOption(dialog)).toBe(options(dialog)[0])

        fireEvent.click(options(dialog)[2]!)
        expect(selectedOption(dialog)).toBe(options(dialog)[2])
    })

    it.each([
        ['no versions yet', () => {}, 'No versions yet. Scrivon keeps one each time you save this file.'],
        ['a file over 5 MB', () => (state.tabs = [tab(A, 'x'.repeat(5 * 1024 * 1024 + 1))]), "Scrivon doesn't keep versions of files over 5 MB"],
        ['file history off', () => (state.historyEnabled = false), 'File history is off'],
    ])('says why the list is empty: %s', async (_, arrange, reason) => {
        state.versions = []
        arrange()
        const dialog = await openHistory()

        expect(within(dialog).getByText(new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument()
        expect(within(dialog).queryByRole('listbox')).not.toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeDisabled()
    })

    it('closes with Esc and gives the editor the keyboard back', async () => {
        const dialog = await openHistory()

        fireEvent.keyDown(within(dialog).getByRole('listbox'), { key: 'Escape' })
        await settle()

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(focusEditorNow).toHaveBeenCalled()
    })

    it('restores with saves held, keeping the editor’s text first, as one edit over the whole text', async () => {
        const dialog = await openHistory()
        fireEvent.keyDown(within(dialog).getByRole('listbox'), { key: 'ArrowDown' })
        await waitFor(() => expect(within(dialog).getByTestId('diff')).toHaveAttribute('data-original', 'saved text'))

        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
        await settle()

        expect(state.calls.slice(2)).toEqual(['hold', 'record', 'edit', 'release'])
        expect(recordFileVersion).toHaveBeenCalledExactlyOnceWith(A, 'the text now', 'before-restore')
        const [tabId, edits] = coordinator.applyTabEdits.current.mock.calls[0] as [string, TextEdit[]]
        expect(tabId).toBe(A)
        // One edit, so Ctrl+Z takes it all back in one step (applyTabEdits makes it one undo step).
        expect(edits).toHaveLength(1)
        expect(applyTextEdits('the text now', edits)).toBe('saved text')
        // Saves held for the tab go on with it once the text is in.
        const whereNow = coordinator.release.mock.calls[0]![0] as (id: string) => string | null
        expect(whereNow(A)).toBe(A)

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        const versionTime = describeVersion(state.versions[1]!).time
        expect(screen.getByText(`Restored the version from ${versionTime}`)).toHaveAttribute('aria-live', 'polite')
        expect(focusEditorNow).toHaveBeenCalled()
    })

    it('keeps nothing first while file history is off, but still restores', async () => {
        state.historyEnabled = false
        const dialog = await openHistory()
        await waitFor(() => expect(within(dialog).getByTestId('diff')).toBeInTheDocument())

        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
        await settle()

        expect(recordFileVersion).not.toHaveBeenCalled()
        expect(coordinator.applyTabEdits.current).toHaveBeenCalledTimes(1)
    })

    it('changes nothing when the editor’s text could not be kept first', async () => {
        vi.mocked(recordFileVersion).mockRejectedValueOnce(new Error('disk full'))
        const dialog = await openHistory()
        await waitFor(() => expect(within(dialog).getByTestId('diff')).toBeInTheDocument())

        fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
        await settle()

        expect(coordinator.applyTabEdits.current).not.toHaveBeenCalled()
        expect(coordinator.release).toHaveBeenCalledTimes(1)
        expect(notifyError).toHaveBeenCalledWith(
            "Couldn't restore a.md",
            expect.any(Error),
            expect.objectContaining({ description: expect.stringContaining('left as it is') })
        )
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('turns Restore off, saying why, for a read-only tab or a version the same as the editor’s text', async () => {
        state.tabs = [tab(A, 'the text now', { readOnly: true })]
        let dialog = await openHistory()
        await waitFor(() => expect(within(dialog).getByTestId('diff')).toBeInTheDocument())

        let restore = within(dialog).getByRole('button', { name: 'Restore' })
        expect(restore).toBeDisabled()
        expect(restore).toHaveAccessibleDescription('This file is read-only, so a version can’t be put back into it.')

        fireEvent.keyDown(dialog, { key: 'Escape' })
        await settle()
        document.body.innerHTML = ''

        state.tabs = [tab(A, 'autosaved text')]
        dialog = await openHistory()
        await waitFor(() => expect(within(dialog).getByTestId('diff')).toBeInTheDocument())
        restore = within(dialog).getByRole('button', { name: 'Restore' })
        expect(restore).toBeDisabled()
        expect(restore).toHaveAccessibleDescription('This version is the same as the text in the editor.')
    })
})
