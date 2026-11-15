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

const newDiagram = { kind: 'new-diagram', folder: '/ws' } as const

const noColons = (name: string) => (name.includes(':') ? 'Name contains invalid characters' : null)

describe('NamePromptProvider', () => {
    it('shows why a name is unusable and stays open with the typed text', async () => {
        const { onResult, input } = await openPrompt({ ...newDiagram, defaultValue: 'diagram.mmd', validate: noColons })
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
        const { onResult, input } = await openPrompt({ ...newDiagram, defaultValue: 'diagram.mmd', validate: noColons })

        fireEvent.change(input, { target: { value: 'my:flow.mmd' } })
        fireEvent.change(input, { target: { value: '  my flow.mmd ' } })
        expect(input).not.toHaveAttribute('aria-invalid')
        fireEvent.click(screen.getByRole('button', { name: 'Create' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith('my flow.mmd'))
    })

    it('selects the name without its extension, so typing keeps the file type', async () => {
        const { input } = await openPrompt({ ...newDiagram, defaultValue: 'diagram 2.mmd' })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'diagram 2'.length])
    })

    it('shows the note it is given under the field while the name can be used, and the error instead when not', async () => {
        const note = (name: string) => (name === 'beach' ? 'Will be named "beach.png".' : null)
        const { input } = await openPrompt({
            kind: 'rename',
            entry: { name: 'screenshot.png', kind: 'file' },
            defaultValue: 'screenshot.png',
            validate: noColons,
            note,
        })
        expect(input).not.toHaveAttribute('aria-describedby')

        fireEvent.change(input, { target: { value: ' beach ' } })
        const shown = screen.getByText('Will be named "beach.png".')
        expect(input).toHaveAttribute('aria-describedby', shown.id)
        expect(input).not.toHaveAttribute('aria-invalid')
        expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled()

        fireEvent.change(input, { target: { value: 'beach:' } })
        expect(screen.queryByText('Will be named "beach.png".')).not.toBeInTheDocument()
        expect(screen.getByText('Name contains invalid characters')).toBeInTheDocument()
    })

    it('selects a whole folder name, even one with a dot', async () => {
        const { input } = await openPrompt({ kind: 'rename', entry: { name: 'v1.2', kind: 'directory' }, defaultValue: 'v1.2' })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'v1.2'.length])
    })

    it('leaves the extension it is given unselected, such as .png for an image', async () => {
        const { input } = await openPrompt({
            kind: 'rename',
            entry: { name: 'screenshot.png', kind: 'file' },
            defaultValue: 'screenshot.png',
            extension: '.png',
        })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'screenshot'.length])
    })

    it('selects the whole name when told there is no extension, even one ending in .md', async () => {
        const { input } = await openPrompt({ kind: 'rename', entry: { name: 'notes.md', kind: 'file' }, defaultValue: 'notes.md', extension: null })

        fireEvent.focus(input)

        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'notes.md'.length])
    })

    it('selects the name only when it opens, not each time focus comes back (switching back to the window)', async () => {
        const { input } = await openPrompt({ ...newDiagram, defaultValue: 'diagram 2.mmd' })
        fireEvent.focus(input)

        fireEvent.change(input, { target: { value: 'login flow.mmd' } })
        input.setSelectionRange(10, 10)
        fireEvent.blur(input)
        fireEvent.focus(input)
        expect([input.selectionStart, input.selectionEnd]).toEqual([10, 10])

        // Opened again, it selects the name again.
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
        fireEvent.click(screen.getByText('Open'))
        const again = (await screen.findByLabelText('Name')) as HTMLInputElement
        fireEvent.focus(again)
        expect([again.selectionStart, again.selectionEnd]).toEqual([0, 'diagram 2'.length])
    })

    it('takes its title, description, placeholder and button from the kind of prompt', async () => {
        const { input } = await openPrompt({ kind: 'new-diagram', folder: '/work/docs' })

        expect(screen.getByRole('dialog', { name: 'New diagram name' })).toBeInTheDocument()
        expect(screen.getByText('Creates the diagram in "docs".')).toBeInTheDocument()
        expect(input).toHaveAttribute('placeholder', 'diagram.mmd')
        expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    it('says Rename on a rename, whatever the names are', async () => {
        const { input } = await openPrompt({ kind: 'rename', entry: { name: 'New folder', kind: 'directory' }, defaultValue: 'New folder' })

        expect(screen.getByRole('dialog', { name: 'Rename "New folder"' })).toBeInTheDocument()
        expect(screen.getByText('Choose a new name for this folder.')).toBeInTheDocument()
        expect(input).toHaveAttribute('placeholder', 'New folder')
        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    })

    it('blocks an empty name and returns null on cancel', async () => {
        const { onResult, input } = await openPrompt({ kind: 'new-folder', folder: '/ws', defaultValue: 'diagrams' })
        expect(input).toHaveAttribute('placeholder', 'Folder name')

        fireEvent.change(input, { target: { value: '   ' } })
        expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
    })
})
