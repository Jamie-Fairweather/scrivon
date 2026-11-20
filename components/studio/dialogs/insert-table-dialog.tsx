'use client'

import { useCallback, useId, useRef, useState, type FormEvent, type ReactElement, type Ref } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { TABLE_COLUMNS, TABLE_ROWS, type TableSize } from '@/lib/markdown/markdown-table'

type Bounds = { min: number; max: number; default: number }

/** A whole number within the bounds, or null for an empty or unreadable field. */
function sizeIn(value: number | null, { min, max }: Bounds): number | null {
    if (value === null || !Number.isFinite(value)) return null
    return Math.min(max, Math.max(min, Math.round(value)))
}

function SizeField({
    label,
    bounds,
    value,
    onChange,
    inputRef,
}: {
    label: string
    bounds: Bounds
    value: number | null
    onChange: (value: number | null) => void
    inputRef?: Ref<HTMLInputElement>
}) {
    const id = useId()
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <NumberField
                id={id}
                className="w-40"
                value={value}
                min={bounds.min}
                max={bounds.max}
                step={1}
                largeStep={5}
                format={{ maximumFractionDigits: 0 }}
                onValueChange={(next) => onChange(next)}
            >
                <NumberFieldGroup>
                    <NumberFieldDecrement aria-label={`Fewer ${label.toLowerCase()}`} />
                    {/* Selected when it takes focus, so typing a number replaces the one there. */}
                    <NumberFieldInput ref={inputRef} onFocus={(event) => event.currentTarget.select()} />
                    <NumberFieldIncrement aria-label={`More ${label.toLowerCase()}`} />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    )
}

/** The form, made again each time the dialog opens, so it starts from the default size. */
function InsertTableForm({ onDone, columnsRef }: { onDone: (size: TableSize | null) => void; columnsRef: Ref<HTMLInputElement> }) {
    const [columns, setColumns] = useState<number | null>(TABLE_COLUMNS.default)
    const [rows, setRows] = useState<number | null>(TABLE_ROWS.default)
    const size = { columns: sizeIn(columns, TABLE_COLUMNS), rows: sizeIn(rows, TABLE_ROWS) }
    const canInsert = size.columns !== null && size.rows !== null

    const submit = (event: FormEvent) => {
        event.preventDefault()
        if (size.columns === null || size.rows === null) return
        onDone({ columns: size.columns, rows: size.rows })
    }

    return (
        <form className="contents" onSubmit={submit}>
            <DialogPanel className="flex gap-4">
                <SizeField label="Columns" bounds={TABLE_COLUMNS} value={columns} onChange={setColumns} inputRef={columnsRef} />
                <SizeField label="Body rows" bounds={TABLE_ROWS} value={rows} onChange={setRows} />
            </DialogPanel>
            <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" />} onClick={() => onDone(null)}>
                    Cancel
                </DialogClose>
                <Button disabled={!canInsert} type="submit">
                    Insert
                </Button>
            </DialogFooter>
        </form>
    )
}

/**
 * Insert Table…: asks how many columns (1 to 20) and body rows (1 to 100) the new table has. Enter
 * inserts and Esc cancels. Closing it puts focus back where it was, in the editor.
 */
export function InsertTableDialog({ open, onDone }: { open: boolean; onDone: (size: TableSize | null) => void }) {
    // A new form each time it opens. Kept while it fades out, so the numbers stay put.
    const [opened, setOpened] = useState(0)
    const [wasOpen, setWasOpen] = useState(open)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) setOpened((count) => count + 1)
    }
    const columnsRef = useRef<HTMLInputElement>(null)
    return (
        <Dialog open={open} onOpenChange={(next) => !next && onDone(null)}>
            <DialogPopup showCloseButton={false} className="max-w-sm" initialFocus={columnsRef}>
                <DialogHeader>
                    <DialogTitle>Insert table</DialogTitle>
                    <DialogDescription>Adds a table with a header row and the rows under it.</DialogDescription>
                </DialogHeader>
                <InsertTableForm key={opened} onDone={onDone} columnsRef={columnsRef} />
            </DialogPopup>
        </Dialog>
    )
}

/** Asks for a new table's size with the Insert Table dialog. Render `dialog`; `askTableSize` resolves to null when the user cancels. */
export function useTableSizePrompt(): { askTableSize: () => Promise<TableSize | null>; dialog: ReactElement } {
    const pendingRef = useRef<((size: TableSize | null) => void) | null>(null)
    const [open, setOpen] = useState(false)

    const finish = useCallback((size: TableSize | null) => {
        pendingRef.current?.(size)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const askTableSize = useCallback(
        () =>
            new Promise<TableSize | null>((resolve) => {
                pendingRef.current?.(null)
                pendingRef.current = resolve
                setOpen(true)
            }),
        []
    )

    return { askTableSize, dialog: <InsertTableDialog open={open} onDone={finish} /> }
}
