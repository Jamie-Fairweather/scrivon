import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderEntry } from '@/lib/tauri/fs'
import type { UnsavedText } from '@/lib/tauri/fs'
import { TemplatePickerProvider, useTemplatePicker, type ChosenTemplate } from './template-picker-provider'

const { fsMock, session, unsaved } = vi.hoisted(() => ({
    fsMock: {
        listFolderEntries: vi.fn<(path: string) => Promise<FolderEntry[]>>(),
        getWorkspaceFileSize: vi.fn<(path: string) => Promise<number | null>>(async () => 100),
        readWorkspaceFile: vi.fn<(path: string) => Promise<string>>(async () => ''),
    },
    session: { workspaceRoot: '/ws' as string | null },
    unsaved: vi.fn<(path: string) => UnsavedText | undefined>(() => undefined),
}))

vi.mock('@/lib/tauri/fs', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tauri/fs')>()), ...fsMock }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useWorkspaceCoordinator: () => ({ getUnsavedContent: { current: unsaved } }),
}))

const file = (name: string): FolderEntry => ({ name, isFile: true, isDirectory: false })

/** Asks for a template when its button is clicked, and shows the answer. */
function Asker() {
    const { chooseTemplate } = useTemplatePicker()
    const [answer, setAnswer] = useState<ChosenTemplate | null | 'none yet'>('none yet')
    return (
        <>
            <button type="button" onClick={() => void chooseTemplate().then(setAnswer)}>
                Ask
            </button>
            <output data-testid="answer">{answer === 'none yet' ? 'none yet' : JSON.stringify(answer)}</output>
        </>
    )
}

async function openPicker() {
    render(
        <TemplatePickerProvider>
            <Asker />
        </TemplatePickerProvider>
    )
    const ask = screen.getByRole('button', { name: 'Ask' })
    ask.focus()
    fireEvent.click(ask)
    const input = await screen.findByRole('combobox', { name: 'Template to start from' })
    return { ask, input }
}

const answer = () => {
    const text = screen.getByTestId('answer').textContent!
    return text === 'none yet' ? text : (JSON.parse(text) as ChosenTemplate | null)
}

const optionTitles = () => screen.getAllByRole('option').map((option) => option.querySelector('span > span')!.textContent)
const groupLabels = () =>
    within(screen.getByRole('listbox'))
        .getAllByRole('group')
        .map((group) => within(group).getAllByText(/./)[0]!.textContent)

/** The picker's own status line (the empty message is a status too). */
const status = () => screen.getAllByRole('status').find((el) => el.dataset.slot !== 'command-empty')!

/** A listing that only finishes when told to. */
function pendingListing() {
    let finish!: (entries: FolderEntry[]) => void
    fsMock.listFolderEntries.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    return (entries: FolderEntry[]) => act(async () => finish(entries))
}

describe('New from Template picker', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        session.workspaceRoot = '/ws'
        fsMock.listFolderEntries.mockResolvedValue([])
        fsMock.getWorkspaceFileSize.mockResolvedValue(100)
        fsMock.readWorkspaceFile.mockResolvedValue('')
        unsaved.mockReturnValue(undefined)
    })

    it("shows the built-in templates at once, then the folder's own above them once they are listed", async () => {
        const finishListing = pendingListing()
        await openPicker()

        expect(screen.getByRole('dialog', { name: 'New from template' })).toBeInTheDocument()
        expect(status()).toHaveTextContent('Loading templates…')
        expect(status()).toHaveAttribute('aria-live', 'polite')
        expect(screen.getByText('Loading templates…', { selector: 'p' })).toBeInTheDocument()
        expect(optionTitles()).toEqual(['Meeting notes', 'Decision record', 'Project brief', 'Process flowchart'])
        expect(fsMock.listFolderEntries).toHaveBeenCalledExactlyOnceWith('/ws/.scrivon/templates')

        await finishListing([file('weekly-review.md'), file('release.mmd')])

        expect(screen.queryByText('Loading templates…', { selector: 'p' })).not.toBeInTheDocument()
        expect(status()).toHaveTextContent('6 templates')
        expect(groupLabels()).toEqual(['This folder', 'Built-in'])
        expect(optionTitles()).toEqual(['Release', 'Weekly review', 'Meeting notes', 'Decision record', 'Project brief', 'Process flowchart'])
    })

    it('shows each template with its title, a description or its file name, and whether it makes a document or a diagram', async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('release.mmd')])
        await openPicker()

        const release = await screen.findByRole('option', { name: /Release/ })
        expect(release).toHaveTextContent('Releaserelease.mmdDiagram')
        expect(screen.getByRole('option', { name: /Meeting notes/ })).toHaveTextContent(/Meeting notes.*action items.*Document/)
        expect(screen.getByRole('option', { name: /Process flowchart/ })).toHaveTextContent(/Diagram$/)
    })

    it('shows only the built-ins and a hint on adding your own when the folder has no templates folder', async () => {
        fsMock.listFolderEntries.mockRejectedValue('The system cannot find the path specified. (os error 3)')
        await openPicker()

        expect(await screen.findByText(/To add your own, put .md or .mmd files in/)).toHaveTextContent(
            'To add your own, put .md or .mmd files in .scrivon/templates at the top of this folder.'
        )
        expect(groupLabels()).toEqual(['Built-in'])
        expect(optionTitles()).toHaveLength(4)
    })

    it('gives no hint when the templates folder is there but empty', async () => {
        await openPicker()
        await waitFor(() => expect(status()).toHaveTextContent('4 templates'))
        expect(screen.queryByText(/To add your own/)).not.toBeInTheDocument()
    })

    it("says when the folder's templates can't be listed, and keeps the built-ins", async () => {
        fsMock.listFolderEntries.mockRejectedValue('Access is denied. (os error 5)')
        await openPicker()

        expect(await screen.findByText("Couldn't list this folder's templates. Access is denied. (os error 5)")).toBeInTheDocument()
        expect(optionTitles()).toHaveLength(4)
    })

    it('narrows the list to the templates that match what is typed', async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('weekly-review.md'), file('release.mmd')])
        const { input } = await openPicker()
        await screen.findByRole('option', { name: /Weekly review/ })

        fireEvent.change(input, { target: { value: 'notes' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Meeting notes']))

        fireEvent.change(input, { target: { value: 'DIAGRAM' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Release', 'Process flowchart']))

        fireEvent.change(input, { target: { value: 'release.mmd' } })
        await waitFor(() => expect(optionTitles()).toEqual(['Release']))

        fireEvent.change(input, { target: { value: 'nothing like it' } })
        expect(await screen.findByText('No templates match.')).toBeInTheDocument()
        expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it('moves with the arrow keys and picks with Enter', async () => {
        const { input } = await openPicker()
        await waitFor(() => expect(status()).toHaveTextContent('4 templates'))

        fireEvent.keyDown(input, { key: 'ArrowDown' })
        await waitFor(() => expect(screen.getByRole('option', { name: /Decision record/ })).toHaveAttribute('data-highlighted'))
        expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /Decision record/ }).id)
        fireEvent.keyDown(input, { key: 'Enter' })

        await waitFor(() => expect(answer()).toMatchObject({ title: 'Decision record', fileName: 'decision-record.md', kind: 'markdown' }))
        expect((answer() as ChosenTemplate).text).toContain('{{title}}')
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('answers null on Escape, and gives focus back to where it was', async () => {
        const { ask, input } = await openPicker()

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Escape' })
        })

        await waitFor(() => expect(answer()).toBeNull())
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(ask).toHaveFocus())
    })

    it('lets a built-in template be picked while the folder ones are still being listed', async () => {
        pendingListing()
        await openPicker()

        fireEvent.click(screen.getByRole('option', { name: /Process flowchart/ }))

        await waitFor(() => expect(answer()).toMatchObject({ title: 'Process flowchart', fileName: 'process-flow.mmd', kind: 'mermaid' }))
        expect(fsMock.readWorkspaceFile).not.toHaveBeenCalled()
    })

    it('reads a folder template only when it is picked, and answers with its text', async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('weekly-review.md')])
        fsMock.readWorkspaceFile.mockResolvedValue('# {{title}}\n\nWeek of {{date}}\n')
        await openPicker()

        const option = await screen.findByRole('option', { name: /Weekly review/ })
        expect(fsMock.readWorkspaceFile).not.toHaveBeenCalled()
        fireEvent.click(option)

        await waitFor(() =>
            expect(answer()).toEqual({
                title: 'Weekly review',
                fileName: 'weekly-review.md',
                kind: 'markdown',
                text: '# {{title}}\n\nWeek of {{date}}\n',
            })
        )
        expect(fsMock.getWorkspaceFileSize).toHaveBeenCalledWith('/ws/.scrivon/templates/weekly-review.md')
        expect(fsMock.readWorkspaceFile).toHaveBeenCalledWith('/ws/.scrivon/templates/weekly-review.md')
    })

    it("says why a folder template over 1 MB can't be used, and stays open to pick another", async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('huge.md')])
        fsMock.getWorkspaceFileSize.mockResolvedValue(2 * 1024 * 1024)
        await openPicker()

        fireEvent.click(await screen.findByRole('option', { name: /Huge/ }))

        expect(await screen.findByRole('alert')).toHaveTextContent('"huge.md" is over 1 MB, which is too big for a template.')
        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(fsMock.readWorkspaceFile).not.toHaveBeenCalled()
        expect(answer()).toBe('none yet')

        fireEvent.click(screen.getByRole('option', { name: /Meeting notes/ }))
        await waitFor(() => expect(answer()).toMatchObject({ title: 'Meeting notes' }))
    })

    it("says why a folder template can't be read, and stays open", async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('locked.md')])
        fsMock.readWorkspaceFile.mockRejectedValue('The process cannot access the file because it is being used by another process. (os error 32)')
        const { input } = await openPicker()
        fireEvent.change(input, { target: { value: 'lock' } })

        fireEvent.click(await screen.findByRole('option', { name: /Locked/ }))

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Couldn\'t read "locked.md". The process cannot access the file because it is being used by another process. (os error 32)'
        )
        // What was typed stays, so the list doesn't jump.
        expect(input).toHaveValue('lock')
        expect(answer()).toBe('none yet')
    })

    it('uses the text of a folder template open in a tab with unsaved edits', async () => {
        fsMock.listFolderEntries.mockResolvedValue([file('weekly-review.md')])
        unsaved.mockImplementation((path) => (path === '/ws/.scrivon/templates/weekly-review.md' ? { content: '# Edited {{title}}\n' } : undefined))
        await openPicker()

        fireEvent.click(await screen.findByRole('option', { name: /Weekly review/ }))

        await waitFor(() => expect(answer()).toMatchObject({ title: 'Weekly review', text: '# Edited {{title}}\n' }))
        expect(fsMock.readWorkspaceFile).not.toHaveBeenCalled()
    })

    it('lists the folder templates afresh each time it opens', async () => {
        fsMock.listFolderEntries.mockResolvedValueOnce([]).mockResolvedValueOnce([file('new-one.md')])
        const { input } = await openPicker()
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Escape' })
        })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

        expect(await screen.findByRole('option', { name: /New one/ })).toBeInTheDocument()
        expect(fsMock.listFolderEntries).toHaveBeenCalledTimes(2)
    })
})
