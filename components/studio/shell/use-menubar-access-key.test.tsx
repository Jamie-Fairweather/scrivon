import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useMenubarAccessKey } from './use-menubar-access-key'

function Harness({ withDialog = false }: { withDialog?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useMenubarAccessKey(ref)
    return (
        <>
            <div ref={ref} role="menubar">
                <button type="button" role="menuitem">
                    File
                </button>
                <button type="button" role="menuitem">
                    Help
                </button>
            </div>
            <input aria-label="editor" />
            {withDialog ? <div data-slot="dialog-popup" role="dialog" /> : null}
        </>
    )
}

function pressAlt(target: Element = document.activeElement ?? document.body) {
    fireEvent.keyDown(target, { key: 'Alt', altKey: true })
    fireEvent.keyUp(target, { key: 'Alt' })
}

describe('useMenubarAccessKey', () => {
    it('moves focus to the first menu on Alt, and back on a second Alt', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        pressAlt()
        expect(screen.getByRole('menuitem', { name: 'File' })).toHaveFocus()

        pressAlt()
        expect(editor).toHaveFocus()
    })

    it('moves focus to the first menu on F10, and back on Escape', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'F10' })
        expect(screen.getByRole('menuitem', { name: 'File' })).toHaveFocus()

        fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
        expect(editor).toHaveFocus()
    })

    it('ignores Alt when another key was pressed with it', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true })
        fireEvent.keyDown(editor, { key: 'ArrowUp', altKey: true })
        fireEvent.keyUp(editor, { key: 'ArrowUp', altKey: true })
        fireEvent.keyUp(editor, { key: 'Alt' })

        expect(editor).toHaveFocus()
    })

    it('ignores Alt+click and Ctrl+Alt (AltGr)', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true })
        fireEvent.pointerDown(editor)
        fireEvent.keyUp(editor, { key: 'Alt' })
        expect(editor).toHaveFocus()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true, ctrlKey: true })
        fireEvent.keyUp(editor, { key: 'Alt' })
        expect(editor).toHaveFocus()
    })

    it('ignores Alt+wheel, which is the editor fast scroll', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true })
        fireEvent.wheel(editor, { deltaY: 120, altKey: true })
        fireEvent.keyUp(editor, { key: 'Alt' })

        expect(editor).toHaveFocus()
    })

    it('ignores Alt when another key is released while it is held (Alt+PrtSc)', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true })
        fireEvent.keyUp(editor, { key: 'PrintScreen', altKey: true })
        fireEvent.keyUp(editor, { key: 'Alt' })

        expect(editor).toHaveFocus()
    })

    it('ignores Shift+F10 (context menu key)', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        fireEvent.keyDown(editor, { key: 'F10', shiftKey: true })
        expect(editor).toHaveFocus()
    })

    it('does nothing while a dialog is open', () => {
        render(<Harness withDialog />)
        const editor = screen.getByLabelText('editor')
        editor.focus()

        pressAlt()
        fireEvent.keyDown(editor, { key: 'F10' })

        expect(editor).toHaveFocus()
    })

    it('leaves F10 alone when another handler already used it', () => {
        render(<Harness />)
        const editor = screen.getByLabelText('editor')
        editor.focus()
        const consume = (event: KeyboardEvent) => event.preventDefault()
        editor.addEventListener('keydown', consume)

        fireEvent.keyDown(editor, { key: 'F10' })

        expect(editor).toHaveFocus()
        editor.removeEventListener('keydown', consume)
    })
})
