import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlobalKeybinds } from '@/components/studio/hooks/use-global-keybinds'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

const bindings = createDefaultKeybinds(false)

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
}

function addElement(attributes: Record<string, string>): HTMLElement {
    const element = document.createElement('div')
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
    document.body.appendChild(element)
    return element
}

describe('useGlobalKeybinds', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('runs the bound action and stops the key', () => {
        const toggleExplorer = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'view.toggleExplorer': toggleExplorer }, { hasWorkspace: true }))

        const event = press('b', { ctrlKey: true, shiftKey: true })

        expect(toggleExplorer).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
    })

    it('does nothing while a modal dialog is open', () => {
        const toggleExplorer = vi.fn()
        const openPalette = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'view.toggleExplorer': toggleExplorer, 'palette.open': openPalette }, { hasWorkspace: true }))
        const dialog = addElement({ role: 'dialog', 'data-open': '' })
        const button = document.createElement('button')
        dialog.appendChild(button)

        const event = press('b', { ctrlKey: true, shiftKey: true }, button)
        press('F1', {}, button)

        expect(toggleExplorer).not.toHaveBeenCalled()
        expect(openPalette).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    it('lets palette shortcuts switch the command palette from its search box while it is the only modal open', () => {
        const toggleExplorer = vi.fn()
        const openPalette = vi.fn()
        const openFiles = vi.fn()
        const openText = vi.fn()
        renderHook(() =>
            useGlobalKeybinds(
                bindings,
                { 'view.toggleExplorer': toggleExplorer, 'palette.open': openPalette, 'palette.openFiles': openFiles, 'palette.openText': openText },
                { hasWorkspace: true }
            )
        )
        const palette = addElement({ role: 'dialog', 'data-open': '', 'data-slot': 'command-dialog-popup' })
        // The palette keeps focus in its search box.
        const input = document.createElement('input')
        palette.appendChild(input)

        const f1 = press('F1', {}, input)
        const ctrlShiftN = press('n', { ctrlKey: true, shiftKey: true }, input)
        const ctrlShiftF = press('f', { ctrlKey: true, shiftKey: true }, input)
        const ctrlB = press('b', { ctrlKey: true, shiftKey: true }, input)

        expect(openPalette).toHaveBeenCalledTimes(1)
        expect(f1.defaultPrevented).toBe(true)
        expect(openFiles).toHaveBeenCalledTimes(1)
        expect(ctrlShiftN.defaultPrevented).toBe(true)
        expect(openText).toHaveBeenCalledTimes(1)
        expect(ctrlShiftF.defaultPrevented).toBe(true)
        expect(toggleExplorer).not.toHaveBeenCalled()
        expect(ctrlB.defaultPrevented).toBe(false)
    })

    it('never fires a palette shortcut bound to a bare key while typing in the palette search box', () => {
        const openFiles = vi.fn()
        renderHook(() => useGlobalKeybinds({ ...bindings, 'palette.openFiles': [{ key: 'n' }] }, { 'palette.openFiles': openFiles }))
        const palette = addElement({ role: 'dialog', 'data-open': '', 'data-slot': 'command-dialog-popup' })
        const input = document.createElement('input')
        palette.appendChild(input)

        const event = press('n', {}, input)

        expect(openFiles).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    it('still skips palette shortcuts in a text field outside the palette', () => {
        const openText = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'palette.openText': openText }))
        const input = document.createElement('input')
        document.body.appendChild(input)

        const event = press('f', { ctrlKey: true, shiftKey: true }, input)

        expect(openText).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    it('keeps palette shortcuts off when another modal is open with the palette', () => {
        const openPalette = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'palette.open': openPalette }))
        addElement({ role: 'dialog', 'data-open': '', 'data-slot': 'command-dialog-popup' })
        addElement({ role: 'alertdialog', 'data-open': '' })

        press('F1')

        expect(openPalette).not.toHaveBeenCalled()
    })

    it('does nothing while an alert dialog is open', () => {
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': save }))
        addElement({ role: 'alertdialog', 'data-open': '' })

        press('s', { ctrlKey: true })

        expect(save).not.toHaveBeenCalled()
    })

    it('still works with closed dialogs, toasts and the editor find widget in the page', () => {
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': save }))
        addElement({ role: 'dialog', 'data-closed': '' })
        addElement({ role: 'dialog', 'aria-modal': 'false', 'data-open': '' })
        addElement({ role: 'dialog', class: 'editor-widget find-widget', 'aria-hidden': 'true' })

        press('s', { ctrlKey: true })

        expect(save).toHaveBeenCalledTimes(1)
    })

    it("doesn't search the page for open dialogs on keys that aren't shortcuts", () => {
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': vi.fn() }, { hasWorkspace: true }))
        const editor = document.createElement('div')
        editor.className = 'monaco-editor'
        document.body.appendChild(editor)
        const querySelectorAll = vi.spyOn(document, 'querySelectorAll')

        press('a', {}, editor)
        press('A', { shiftKey: true }, editor)

        expect(querySelectorAll).not.toHaveBeenCalled()
        querySelectorAll.mockRestore()
    })

    describe('in the editor', () => {
        /** Monaco's editor with the element it types into (a div on Windows) and its find box. */
        function addEditor() {
            const editor = addElement({ class: 'monaco-editor' })
            const text = document.createElement('div')
            text.className = 'native-edit-context'
            const findBox = document.createElement('textarea')
            editor.append(text, findBox)
            return { text, findBox }
        }

        it('gives the keys to a Markdown action while typing, and to the app action everywhere else', () => {
            const code = vi.fn()
            const toggleEditor = vi.fn()
            renderHook(() => useGlobalKeybinds(bindings, { 'format.code': code, 'view.toggleEditor': toggleEditor }, { hasWorkspace: true }))
            const { text, findBox } = addEditor()

            const typing = press('e', { ctrlKey: true }, text)
            expect(code).toHaveBeenCalledTimes(1)
            expect(toggleEditor).not.toHaveBeenCalled()
            expect(typing.defaultPrevented).toBe(true)

            press('e', { ctrlKey: true }, findBox)
            press('e', { ctrlKey: true })
            expect(code).toHaveBeenCalledTimes(1)
            expect(toggleEditor).toHaveBeenCalledTimes(2)
        })

        it('passes the keys on when the Markdown action turns them down, as outside a Markdown file', () => {
            const toggleEditor = vi.fn()
            renderHook(() =>
                useGlobalKeybinds(
                    bindings,
                    { 'format.code': () => false, 'format.bold': () => false, 'view.toggleEditor': toggleEditor },
                    { hasWorkspace: true }
                )
            )
            const { text } = addEditor()

            press('e', { ctrlKey: true }, text)
            const ctrlB = press('b', { ctrlKey: true }, text)

            expect(toggleEditor).toHaveBeenCalledTimes(1)
            // Nothing else has Ctrl+B, so the editor gets it.
            expect(ctrlB.defaultPrevented).toBe(false)
        })
    })

    it('ignores keys something else already handled', () => {
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': save }))
        const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
        event.preventDefault()

        document.body.dispatchEvent(event)

        expect(save).not.toHaveBeenCalled()
    })

    it('does nothing when disabled', () => {
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': save }, { enabled: false }))

        press('s', { ctrlKey: true })

        expect(save).not.toHaveBeenCalled()
    })
})
