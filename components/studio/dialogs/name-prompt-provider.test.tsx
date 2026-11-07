import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NamePromptProvider, useNamePrompt, type NamePromptOptions } from './name-prompt-provider'

function Opener({ options, onResult }: { options: NamePromptOptions; onResult: (name: string | null) => void }) {
    const { promptName } = useNamePrompt()
    return (
        <button type="button" onClick={() => void promptName(options).then(onResult)}>
            Open
        </button>
    )
}

async function openPrompt(options: NamePromptOptions) {
    const onResult = vi.fn()
    render(
        <NamePromptProvider>
            <Opener options={options} onResult={onResult} />
        </NamePromptProvider>
    )
    fireEvent.click(screen.getByText('Open'))
    const input = await screen.findByLabelText('Name')
    return { onResult, input: input as HTMLInputElement }
}

const noColons = (name: string) => (name.includes(':') ? 'Name contains invalid characters' : null)

describe('NamePromptProvider', () => {
    it('shows why a name is unusable and stays open with the typed text', async () => {
        const { onResult, input } = await openPrompt({ title: 'New diagram name', defaultValue: 'diagram.mmd', validate: noColons })
        expect(screen.queryByText('Name contains invalid characters')).not.toBeInTheDocument()

        fireEvent.change(input, { target: { value: 'my:flow.mmd' } })

        expect(screen.getByText('Name contains invalid characters')).toBeInTheDocument()
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
        fireEvent.submit(input.closest('form')!)
        expect(onResult).not.toHaveBeenCalled()
        expect(input).toHaveValue('my:flow.mmd')
    })

    it('returns the trimmed name once it is fixed', async () => {
        const { onResult, input } = await openPrompt({ title: 'New diagram name', defaultValue: 'diagram.mmd', validate: noColons })

        fireEvent.change(input, { target: { value: 'my:flow.mmd' } })
        fireEvent.change(input, { target: { value: '  my flow.mmd ' } })
        expect(input).not.toHaveAttribute('aria-invalid')
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith('my flow.mmd'))
    })

    it('selects the name without its extension, so typing keeps the file type', async () => {
        const { input } = await openPrompt({ title: 'New diagram name', defaultValue: 'diagram 2.mmd' })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'diagram 2'.length])
    })

    it('selects a whole folder name, even one with a dot', async () => {
        const { input } = await openPrompt({ title: 'Rename', defaultValue: 'v1.2' })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'v1.2'.length])
    })

    it('leaves the extension it is given unselected, such as .png for an image', async () => {
        const { input } = await openPrompt({ title: 'Rename', defaultValue: 'screenshot.png', extension: '.png' })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'screenshot'.length])
    })

    it('selects the whole name when told there is no extension, even one ending in .md', async () => {
        const { input } = await openPrompt({ title: 'Rename', defaultValue: 'notes.md', extension: null })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'notes.md'.length])
    })

    it('shows the description and button label it is given', async () => {
        await openPrompt({ title: 'Rename "notes.md"', description: 'Choose a new name for this file.', submitLabel: 'Rename' })

        expect(screen.getByText('Choose a new name for this file.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    })

    it('does not guess a description from the title', async () => {
        await openPrompt({ title: 'Rename "drafts"', defaultValue: 'drafts' })

        expect(screen.queryByText(/choose a new name/i)).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    it('blocks an empty name and returns null on cancel', async () => {
        const { onResult, input } = await openPrompt({ title: 'New folder name', defaultValue: 'diagrams', placeholder: 'Folder name' })
        expect(input).toHaveAttribute('placeholder', 'Folder name')

        fireEvent.change(input, { target: { value: '   ' } })
        expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
    })
})
