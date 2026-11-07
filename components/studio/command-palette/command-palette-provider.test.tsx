import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteProvider, useCommandPalette, useOptionalCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import type { PaletteGroup, PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { notifyError } from '@/lib/notify'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

const search = vi.hoisted(() => ({
    enabled: false,
    groups: [] as PaletteGroup[],
    runItem: (async () => {}) as (item: PaletteItem) => Promise<void>,
}))

vi.mock('@/components/studio/editor/editor-focus', () => ({ focusEditorFor: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notifyError: vi.fn() }))

vi.mock('@/components/studio/command-palette/use-palette-search', async () => {
    const { useCallback, useState } = await import('react')
    return {
        usePaletteSearch: (_mode: unknown, enabled: boolean) => {
            search.enabled = enabled
            const [query, setQuery] = useState('')
            const resetSearch = useCallback(() => setQuery(''), [])
            return {
                query,
                setQuery,
                resetSearch,
                groups: search.groups,
                isSearchingText: false,
                textCapped: false,
                textUnreadableFiles: 0,
                textTruncatedFiles: 0,
                runItem: (item: PaletteItem) => search.runItem(item),
                hasWorkspace: true,
            }
        },
    }
})

const palette: { openMode: (mode: PaletteMode) => void } = { openMode: () => {} }

beforeAll(() => {
    // happy-dom has no Web Animations API, which Base UI's scroll area calls on a timer.
    if (typeof Element.prototype.getAnimations !== 'function') Element.prototype.getAnimations = () => []
})

beforeEach(() => {
    search.groups = []
    search.runItem = async () => {}
})

function CaptureOpenMode() {
    const { openMode } = useCommandPalette()
    useEffect(() => {
        palette.openMode = openMode
    }, [openMode])
    return null
}

function renderProvider(selection: string | null) {
    const coordinator: WorkspaceCoordinatorRefs = createWorkspaceCoordinatorRefs()
    coordinator.getEditorSelectedText.current = () => selection
    render(
        <CommandPaletteProvider coordinator={coordinator}>
            <CaptureOpenMode />
            {/* Stands in for Monaco: its focused element sits inside `.monaco-editor`. */}
            <div className="monaco-editor">
                <div data-testid="editor" tabIndex={0} />
            </div>
            <button type="button">Explorer</button>
        </CommandPaletteProvider>
    )
}

function focusEditor() {
    act(() => screen.getByTestId('editor').focus())
}

describe('CommandPaletteProvider query seeding', () => {
    beforeEach(() => {
        palette.openMode = () => {}
    })

    it('does not copy the editor selection into the command palette', () => {
        renderProvider('flowchart')
        focusEditor()
        act(() => palette.openMode('all'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('does not copy the editor selection into Go to File', () => {
        renderProvider('flowchart')
        focusEditor()
        act(() => palette.openMode('files'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('starts Find in Workspace from a single-line selection', () => {
        renderProvider('  flowchart ')
        focusEditor()
        act(() => palette.openMode('text'))
        expect(screen.getByRole('combobox')).toHaveValue('flowchart')
    })

    it('ignores a selection left in the editor after the user moved to another part of the app', () => {
        renderProvider('flowchart')
        focusEditor()
        act(() => screen.getByRole('button', { name: 'Explorer' }).focus())
        act(() => palette.openMode('text'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('ignores a multi-line selection', () => {
        renderProvider('graph TD\n  A --> B')
        focusEditor()
        act(() => palette.openMode('text'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('keeps what the user typed when the palette is opened again while open', () => {
        renderProvider('flowchart')
        act(() => palette.openMode('all'))
        const input = screen.getByRole('combobox')
        fireEvent.change(input, { target: { value: '>save' } })
        expect(input).toHaveValue('>save')

        act(() => palette.openMode('text'))
        expect(screen.getByRole('combobox')).toHaveValue('>save')
        expect(screen.getByPlaceholderText('Find in workspace…')).toBeInTheDocument()
    })
})

describe('CommandPaletteProvider closing', () => {
    beforeEach(() => {
        palette.openMode = () => {}
    })

    it('keeps the results while the palette fades out and clears them once it has closed', async () => {
        renderProvider(null)
        act(() => palette.openMode('all'))
        const input = screen.getByRole('combobox')
        fireEvent.change(input, { target: { value: '>theme' } })

        fireEvent.keyDown(input, { key: 'Escape' })
        // Still fading out: the list keeps its query instead of jumping to the default results.
        expect(input).toHaveValue('>theme')
        expect(search.enabled).toBe(true)

        await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull())
        expect(search.enabled).toBe(false)

        act(() => palette.openMode('all'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('starts empty when reopened before the fade-out has finished', () => {
        renderProvider(null)
        act(() => palette.openMode('all'))
        const input = screen.getByRole('combobox')
        fireEvent.change(input, { target: { value: '>theme' } })
        fireEvent.keyDown(input, { key: 'Escape' })

        act(() => palette.openMode('files'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })
})

describe('CommandPaletteProvider after a pick', () => {
    const file: PaletteItem = {
        kind: 'file',
        value: 'file:/ws/notes.md',
        searchText: 'notes.md',
        path: '/ws/notes.md',
        name: 'notes.md',
        relativePath: 'notes.md',
        documentKind: 'markdown',
    }

    beforeEach(() => {
        vi.mocked(focusEditorFor).mockClear()
        palette.openMode = () => {}
        search.groups = [{ id: 'files', label: 'Files', items: [file] }]
        search.runItem = async () => {}
    })

    it('puts the keyboard in the editor once the picked file has opened', async () => {
        let finishOpening = () => {}
        search.runItem = () => new Promise<void>((resolve) => (finishOpening = resolve))
        renderProvider(null)
        act(() => palette.openMode('all'))

        fireEvent.click(screen.getByRole('option', { name: /notes.md/ }))
        // Not before the file is open: the editor would still show the old one.
        await act(async () => {})
        expect(focusEditorFor).not.toHaveBeenCalled()

        await act(async () => finishOpening())
        expect(focusEditorFor).toHaveBeenCalledWith('/ws/notes.md')
    })

    it('leaves focus alone after a command', async () => {
        const run = vi.fn()
        search.groups = [{ id: 'actions', label: 'Commands', items: [{ kind: 'action', value: 'action:x', searchText: 'x', label: 'Do X', run }] }]
        search.runItem = async (item) => {
            if (item.kind === 'action') await item.run()
        }
        renderProvider(null)
        act(() => palette.openMode('all'))

        fireEvent.click(screen.getByRole('option', { name: /Do X/ }))

        await waitFor(() => expect(run).toHaveBeenCalled())
        expect(focusEditorFor).not.toHaveBeenCalled()
    })
})

describe('CommandPaletteProvider when the palette fails to draw', () => {
    beforeEach(() => {
        palette.openMode = () => {}
        vi.mocked(notifyError).mockClear()
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => vi.restoreAllMocks())

    it('closes the palette with a notice and clears the search, keeping the rest of the app', async () => {
        // A text hit with no preview line: drawing it fails.
        const broken = { kind: 'text', value: 'text:/ws/a.md:1:1', searchText: 'a.md', path: '/ws/a.md', name: 'a.md' } as unknown as PaletteItem
        search.groups = [{ id: 'text', label: 'Text', items: [broken] }]
        renderProvider(null)

        act(() => palette.openMode('all'))

        await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1))
        expect(vi.mocked(notifyError).mock.calls[0]![0]).toBe("Couldn't show the command palette")
        expect(screen.queryByRole('combobox')).toBeNull()
        expect(search.enabled).toBe(false)
        expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument()

        search.groups = []
        act(() => palette.openMode('all'))
        expect(await screen.findByRole('combobox')).toHaveValue('')
        expect(notifyError).toHaveBeenCalledTimes(1)
    })
})

describe('useOptionalCommandPalette', () => {
    it('gives null outside the provider, where useCommandPalette throws', () => {
        expect(renderHook(() => useOptionalCommandPalette()).result.current).toBeNull()
        expect(() => renderHook(() => useCommandPalette())).toThrow('useCommandPalette must be used within CommandPaletteProvider')
    })

    it('gives the palette inside the provider', () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useOptionalCommandPalette(), {
            wrapper: ({ children }) => <CommandPaletteProvider coordinator={coordinator}>{children}</CommandPaletteProvider>,
        })
        expect(result.current?.open).toEqual(expect.any(Function))
    })
})
