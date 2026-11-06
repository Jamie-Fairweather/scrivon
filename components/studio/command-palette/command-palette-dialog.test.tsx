import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'

type DialogProps = ComponentProps<typeof CommandPaletteDialog>

beforeAll(() => {
    // happy-dom has no Web Animations API, which Base UI's scroll area calls on a timer.
    if (typeof Element.prototype.getAnimations !== 'function') Element.prototype.getAnimations = () => []
})

function renderDialog(overrides: Partial<DialogProps> = {}) {
    const props: DialogProps = {
        open: true,
        onOpenChange: vi.fn(),
        mode: 'all',
        onModeChange: vi.fn(),
        query: '',
        onQueryChange: vi.fn(),
        groups: [],
        isSearchingText: false,
        textCapped: false,
        textUnreadableFiles: 0,
        hasWorkspace: true,
        onSelectItem: vi.fn(),
        ...overrides,
    }
    render(<CommandPaletteDialog {...props} />)
    return props
}

describe('CommandPaletteDialog modes', () => {
    it('shows which mode is active in the placeholder', () => {
        renderDialog({ mode: 'files' })
        expect(screen.getByPlaceholderText('Go to file…')).toBeInTheDocument()
    })

    it('uses the general placeholder and no filter chip in the default mode', () => {
        renderDialog({ mode: 'all' })
        expect(screen.getByPlaceholderText('Search files, text, and commands…')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /show all results/i })).toBeNull()
    })

    it('shows a filter chip that switches back to all results', () => {
        const props = renderDialog({ mode: 'text' })
        expect(screen.getByPlaceholderText('Find in workspace…')).toBeInTheDocument()

        const chip = screen.getByRole('button', { name: 'Text only. Show all results' })
        fireEvent.click(chip)
        expect(props.onModeChange).toHaveBeenCalledWith('all')
    })

    it('removes the filter when Backspace is pressed in an empty box', () => {
        const props = renderDialog({ mode: 'files' })
        fireEvent.keyDown(screen.getByPlaceholderText('Go to file…'), { key: 'Backspace' })
        expect(props.onModeChange).toHaveBeenCalledWith('all')
    })

    it('keeps the filter when Backspace deletes typed text', () => {
        const props = renderDialog({ mode: 'files', query: 'readme' })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' })
        expect(props.onModeChange).not.toHaveBeenCalled()
    })

    it('keeps the filter while Backspace is held down after clearing the box', () => {
        const props = renderDialog({ mode: 'files' })
        fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace', repeat: true })
        expect(props.onModeChange).not.toHaveBeenCalled()
    })

    it('explains that file contents need two characters in Find in Workspace', () => {
        renderDialog({ mode: 'text', query: 'a' })
        // Base UI briefly appends an invisible marker to the empty text, so match without anchoring the end.
        expect(screen.getByText(/^Type at least 2 characters to search file contents\./)).toBeInTheDocument()
    })

    it('explains that results are filtered when nothing matches in a narrowed mode', () => {
        renderDialog({ mode: 'text', query: 'readme' })
        expect(screen.getByText(/^No text matches\. Remove the Text filter to search file names too\./)).toBeInTheDocument()
    })
})

describe('CommandPaletteDialog pre-filled query', () => {
    it('selects a pre-filled query when it opens, so typing replaces it', async () => {
        renderDialog({ mode: 'text', query: 'flowchart' })
        const input = screen.getByRole<HTMLInputElement>('combobox')

        await waitFor(() => expect(input).toHaveFocus())
        expect(input.selectionStart).toBe(0)
        expect(input.selectionEnd).toBe('flowchart'.length)
    })
})
