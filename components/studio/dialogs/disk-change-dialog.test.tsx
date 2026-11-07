import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { confirmOverwriteDiskChange, DiskChangeDialog, type DiskChange, type DiskChangeChoice } from './disk-change-dialog'

async function ask(fileName: string, change: DiskChange) {
    let answer!: Promise<DiskChangeChoice>
    act(() => {
        answer = confirmOverwriteDiskChange(fileName, change)
    })
    await screen.findByRole('alertdialog')
    // Wrapped, so awaiting this waits for the question to show and not for its answer.
    return { answer }
}

function buttonNames() {
    return screen.getAllByRole('button').map((b) => b.textContent)
}

describe('DiskChangeDialog', () => {
    it('starts on Don’t Save, so Enter or Space typed as it opens keeps both versions', async () => {
        const user = userEvent.setup()
        render(<DiskChangeDialog />)

        const { answer } = await ask('notes.md', 'changed')
        expect(screen.getByRole('alertdialog')).toHaveTextContent('notes.md was changed outside Scrivon since you opened it.')
        expect(buttonNames()).toEqual(["Don't Save", 'Reload', 'Overwrite'])
        await waitFor(() => expect(screen.getByRole('button', { name: "Don't Save" })).toHaveFocus())

        await user.keyboard('{Enter}')
        await expect(answer).resolves.toBe('keep')

        const { answer: second } = await ask('notes.md', 'changed')
        await waitFor(() => expect(screen.getByRole('button', { name: "Don't Save" })).toHaveFocus())
        await user.keyboard(' ')
        await expect(second).resolves.toBe('keep')
    })

    it('keeps both versions on Esc', async () => {
        const user = userEvent.setup()
        render(<DiskChangeDialog />)

        const { answer } = await ask('notes.md', 'changed')
        await user.keyboard('{Escape}')
        await expect(answer).resolves.toBe('keep')
    })

    it('answers with the button that was clicked', async () => {
        const user = userEvent.setup()
        render(<DiskChangeDialog />)

        const { answer: overwrite } = await ask('notes.md', 'changed')
        await user.click(screen.getByRole('button', { name: 'Overwrite' }))
        await expect(overwrite).resolves.toBe('overwrite')

        const { answer: reload } = await ask('notes.md', 'changed')
        await user.click(screen.getByRole('button', { name: 'Reload' }))
        await expect(reload).resolves.toBe('reload')
    })

    it('offers to save a deleted file again, with nothing to reload', async () => {
        const user = userEvent.setup()
        render(<DiskChangeDialog />)

        const { answer } = await ask('gone.md', 'deleted')
        expect(screen.getByRole('alertdialog')).toHaveTextContent('gone.md was deleted or moved outside Scrivon. Save your version there again?')
        expect(buttonNames()).toEqual(["Don't Save", 'Save Again'])
        await user.click(screen.getByRole('button', { name: 'Save Again' }))
        await expect(answer).resolves.toBe('overwrite')
    })

    it('never overwrites when there is nothing on screen to ask with', async () => {
        await expect(confirmOverwriteDiskChange('notes.md', 'changed')).resolves.toBe('keep')

        const { unmount } = render(<DiskChangeDialog />)
        const { answer } = await ask('notes.md', 'changed')
        unmount()
        await expect(answer).resolves.toBe('keep')
        await expect(confirmOverwriteDiskChange('notes.md', 'changed')).resolves.toBe('keep')
    })
})
