import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { useMenubarAccessKey } from './use-menubar-access-key'

function Harness({ withDialog = false, onFinalFocus }: { withDialog?: boolean; onFinalFocus?: (resolve: () => HTMLElement | boolean) => void }) {
    const ref = useRef<HTMLDivElement>(null)
    const finalFocus = useMenubarAccessKey(ref)
    onFinalFocus?.(finalFocus)
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
            <button type="button">Elsewhere</button>
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

    describe('after a menu command', () => {
        function renderWithResolver() {
            let resolve: () => HTMLElement | boolean = () => true
            render(<Harness onFinalFocus={(fn) => (resolve = fn)} />)
            return () => resolve()
        }

        it('sends focus back to where it was before Alt', () => {
            const finalFocus = renderWithResolver()
            const editor = screen.getByLabelText('editor')
            editor.focus()

            pressAlt()

            expect(finalFocus()).toBe(editor)
            // Used once: the next command falls back to the menu title.
            expect(finalFocus()).toBe(true)
        })

        it('sends focus back to where it was before a click on a menu title', () => {
            const finalFocus = renderWithResolver()
            const editor = screen.getByLabelText('editor')
            editor.focus()

            screen.getByRole('menuitem', { name: 'Help' }).focus()

            expect(finalFocus()).toBe(editor)
        })

        it('leaves focus where the command put it, such as in a dialog it opened', () => {
            const finalFocus = renderWithResolver()
            const editor = screen.getByLabelText('editor')
            editor.focus()
            pressAlt()

            screen.getByRole('button', { name: 'Elsewhere' }).focus()

            expect(finalFocus()).toBe(false)
        })

        it('falls back to the menu title when the command hid where focus was', () => {
            const finalFocus = renderWithResolver()
            const editor = screen.getByLabelText('editor')
            editor.focus()
            pressAlt()

            // Preview Only hides the editor pane, which stays on the page but inert.
            editor.setAttribute('inert', '')

            expect(finalFocus()).toBe(true)
        })

        it('falls back to the menu title when there is nowhere to go back to', () => {
            const finalFocus = renderWithResolver()

            screen.getByRole('menuitem', { name: 'File' }).focus()

            expect(finalFocus()).toBe(true)
        })
    })
})
