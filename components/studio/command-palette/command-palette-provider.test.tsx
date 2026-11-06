import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteProvider, useCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import type { PaletteMode } from '@/components/studio/command-palette/types'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

const search = vi.hoisted(() => ({ enabled: false }))

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
                groups: [],
                isSearchingText: false,
                textCapped: false,
                textUnreadableFiles: 0,
                textTruncatedFiles: 0,
                runItem: async () => {},
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
        </CommandPaletteProvider>
    )
}

describe('CommandPaletteProvider query seeding', () => {
    beforeEach(() => {
        palette.openMode = () => {}
    })

    it('does not copy the editor selection into the command palette', () => {
        renderProvider('flowchart')
        act(() => palette.openMode('all'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('does not copy the editor selection into Go to File', () => {
        renderProvider('flowchart')
        act(() => palette.openMode('files'))
        expect(screen.getByRole('combobox')).toHaveValue('')
    })

    it('starts Find in Workspace from a single-line selection', () => {
        renderProvider('  flowchart ')
        act(() => palette.openMode('text'))
        expect(screen.getByRole('combobox')).toHaveValue('flowchart')
    })

    it('ignores a multi-line selection', () => {
        renderProvider('graph TD\n  A --> B')
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
