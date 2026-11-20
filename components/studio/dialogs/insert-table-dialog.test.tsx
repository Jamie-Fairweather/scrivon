import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TableSize } from '@/lib/markdown/markdown-table'
import { useTableSizePrompt } from './insert-table-dialog'

/** Stands in for the editor: it has focus when the dialog opens, as Insert Table… gives it focus first. */
function Editor({ onResult }: { onResult: (size: TableSize | null) => void }) {
    const { askTableSize, dialog } = useTableSizePrompt()
    return (
        <>
            <textarea aria-label="Editor" />
            <button type="button" onClick={() => void askTableSize().then(onResult)}>
                Insert table
            </button>
            {dialog}
        </>
    )
}

async function openDialog() {
    const onResult = vi.fn()
    render(<Editor onResult={onResult} />)
    const editor = screen.getByLabelText('Editor')
    editor.focus()
    // Open from the keyboard shortcut, with the editor focused.
    act(() => screen.getByRole('button', { name: 'Insert table' }).click())
    editor.focus()
    await screen.findByRole('dialog')
    return { onResult, editor }
}

const columnsField = () => screen.getByLabelText('Columns') as HTMLInputElement
const rowsField = () => screen.getByLabelText('Body rows') as HTMLInputElement

describe('Insert Table dialog', () => {
    it('has labelled number fields, starting at 3 columns and 2 body rows, with the columns field focused', async () => {
        await openDialog()

        expect(columnsField()).toHaveValue('3')
        expect(rowsField()).toHaveValue('2')
        await waitFor(() => expect(columnsField()).toHaveFocus())
    })

    it('inserts on Enter with the size typed', async () => {
        const { onResult } = await openDialog()
        const user = userEvent.setup()

        await user.clear(columnsField())
        await user.type(columnsField(), '5')
        await user.clear(rowsField())
        await user.type(rowsField(), '10{Enter}')

        await waitFor(() => expect(onResult).toHaveBeenCalledWith({ columns: 5, rows: 10 }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('keeps columns to 1-20 and body rows to 1-100', async () => {
        const { onResult } = await openDialog()

        fireEvent.change(columnsField(), { target: { value: '50' } })
        fireEvent.change(rowsField(), { target: { value: '0' } })
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith({ columns: 20, rows: 1 }))
    })

    it('turns Insert off while a field is empty', async () => {
        const { onResult } = await openDialog()

        fireEvent.change(columnsField(), { target: { value: '' } })

        expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled()
        fireEvent.submit(columnsField().closest('form')!)
        expect(onResult).not.toHaveBeenCalled()
    })

    it('steps with its buttons', async () => {
        const { onResult } = await openDialog()

        fireEvent.click(screen.getByRole('button', { name: 'More columns' }))
        fireEvent.click(screen.getByRole('button', { name: 'Fewer body rows' }))
        fireEvent.click(screen.getByRole('button', { name: 'Insert' }))

        await waitFor(() => expect(onResult).toHaveBeenCalledWith({ columns: 4, rows: 1 }))
    })

    it('cancels on Esc and puts focus back in the editor', async () => {
        const { onResult, editor } = await openDialog()
        await waitFor(() => expect(columnsField()).toHaveFocus())

        await userEvent.setup().keyboard('{Escape}')

        await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
        await waitFor(() => expect(editor).toHaveFocus())
    })

    it('starts from the default size again each time it opens', async () => {
        const { onResult } = await openDialog()
        fireEvent.change(columnsField(), { target: { value: '7' } })
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(onResult).toHaveBeenCalledWith(null))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        act(() => screen.getByRole('button', { name: 'Insert table' }).click())
        await screen.findByRole('dialog')

        expect(columnsField()).toHaveValue('3')
    })
})
