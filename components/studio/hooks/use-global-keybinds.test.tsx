import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlobalKeybinds } from '@/components/studio/hooks/use-global-keybinds'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'
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
        // Unmount first: React can't take down a popover once its page is gone.
        cleanup()
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

    it('still zooms the app behind a dialog, even from its text box', () => {
        const zoomIn = vi.fn()
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'view.appZoomIn': zoomIn, 'document.save': save }))
        const dialog = addElement({ role: 'dialog', 'data-open': '' })
        const input = document.createElement('input')
        dialog.appendChild(input)

        const event = press('=', { ctrlKey: true }, input)
        press('s', { ctrlKey: true }, input)

        expect(zoomIn).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
        expect(save).not.toHaveBeenCalled()
    })

    it('still works while a popover is open with focus inside it, as popovers are not modal', async () => {
        const save = vi.fn()
        renderHook(() => useGlobalKeybinds(bindings, { 'document.save': save }))
        render(
            <Popover>
                <PopoverTrigger>Save failed</PopoverTrigger>
                <PopoverPopup>
                    <button type="button">Try Again</button>
                </PopoverPopup>
            </Popover>
        )
        await userEvent.click(screen.getByRole('button', { name: 'Save failed' }))
        const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
        await waitFor(() => expect(tryAgain).toHaveFocus())

        const event = press('s', { ctrlKey: true }, tryAgain)

        expect(save).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
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

        describe('while a key is held down', () => {
            it('stops the repeats of a key the app took, without running it again', () => {
                const italic = vi.fn()
                renderHook(() => useGlobalKeybinds(bindings, { 'format.italic': italic }, { hasWorkspace: true }))
                const { text } = addEditor()

                press('i', { ctrlKey: true, code: 'KeyI' }, text)
                const repeats = [
                    press('i', { ctrlKey: true, code: 'KeyI', repeat: true }, text),
                    press('i', { ctrlKey: true, code: 'KeyI', repeat: true }, text),
                ]

                expect(italic).toHaveBeenCalledTimes(1)
                // Not on to the editor, where Ctrl+I opens the suggestions.
                expect(repeats.map((event) => event.defaultPrevented)).toEqual([true, true])
            })

            it('passes the repeats on when the first press was passed on', () => {
                const { text } = addEditor()
                renderHook(() => useGlobalKeybinds(bindings, { 'format.bold': () => false }, { hasWorkspace: true }))

                press('b', { ctrlKey: true, code: 'KeyB' }, text)
                const repeat = press('b', { ctrlKey: true, code: 'KeyB', repeat: true }, text)

                expect(repeat.defaultPrevented).toBe(false)
            })

            it('does not stop the repeats of another key pressed after it', () => {
                const italic = vi.fn()
                renderHook(() => useGlobalKeybinds(bindings, { 'format.italic': italic }, { hasWorkspace: true }))
                const { text } = addEditor()

                press('i', { ctrlKey: true, code: 'KeyI' }, text)
                press('a', { code: 'KeyA' }, text)
                const repeat = press('a', { code: 'KeyA', repeat: true }, text)

                expect(repeat.defaultPrevented).toBe(false)
            })

            it('runs a shortcut that is meant to repeat on every repeat', () => {
                const nextTab = vi.fn()
                renderHook(() => useGlobalKeybinds(bindings, { 'tabs.next': nextTab }, { hasWorkspace: true }))

                press('Tab', { ctrlKey: true, code: 'Tab' })
                const repeat = press('Tab', { ctrlKey: true, code: 'Tab', repeat: true })

                expect(nextTab).toHaveBeenCalledTimes(2)
                expect(repeat.defaultPrevented).toBe(true)
            })
        })

        describe('after Ctrl+K reaches the editor', () => {
            afterEach(() => {
                vi.useRealTimers()
                vi.unstubAllGlobals()
            })

            /** As in a Mermaid file, where Link is off and passes Ctrl+K on. */
            function renderInDiagram(handlers: Parameters<typeof useGlobalKeybinds>[1]) {
                renderHook(() => useGlobalKeybinds(bindings, { 'format.link': () => false, ...handlers }, { hasWorkspace: true }))
                return addEditor()
            }

            it('leaves the next key to the editor, so Ctrl+K Ctrl+0 folds instead of resetting the zoom', () => {
                const zoomReset = vi.fn()
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.appZoomReset': zoomReset, 'view.focusEditor': focusEditor })

                const ctrlK = press('k', { ctrlKey: true }, text)
                const ctrl0 = press('0', { ctrlKey: true }, text)

                expect(ctrlK.defaultPrevented).toBe(false)
                expect(zoomReset).not.toHaveBeenCalled()
                expect(ctrl0.defaultPrevented).toBe(false)

                // Only the one key: the next Ctrl+1 is the app's again.
                press('1', { ctrlKey: true }, text)
                expect(focusEditor).toHaveBeenCalledTimes(1)
            })

            it('still waits while Ctrl is pressed again on its own', () => {
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.focusEditor': focusEditor })

                press('k', { ctrlKey: true }, text)
                press('Control', { ctrlKey: true }, text)
                press('1', { ctrlKey: true }, text)

                expect(focusEditor).not.toHaveBeenCalled()
            })

            it('gives the keys back to the app after 5 seconds, when the editor has stopped waiting', () => {
                vi.useFakeTimers()
                const zoomReset = vi.fn()
                const { text } = renderInDiagram({ 'view.appZoomReset': zoomReset })

                press('k', { ctrlKey: true }, text)
                vi.advanceTimersByTime(5001)
                press('0', { ctrlKey: true }, text)

                expect(zoomReset).toHaveBeenCalledTimes(1)
            })

            it('knows Ctrl+K by its key on a Russian keyboard, where it types л', () => {
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.focusEditor': focusEditor })

                press('л', { ctrlKey: true, code: 'KeyK' }, text)
                press('1', { ctrlKey: true }, text)

                expect(focusEditor).not.toHaveBeenCalled()
            })

            it('waits after Cmd+K on a Mac, not Ctrl+K, which is a shortcut on its own there', () => {
                vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.focusEditor': focusEditor })

                press('k', { ctrlKey: true }, text)
                press('1', { ctrlKey: true }, text)
                press('k', { metaKey: true }, text)
                press('1', { ctrlKey: true }, text)

                expect(focusEditor).toHaveBeenCalledTimes(1)
            })

            it('runs app shortcuts pressed outside the editor, which never sees them', () => {
                const save = vi.fn()
                const { text } = renderInDiagram({ 'document.save': save })

                press('k', { ctrlKey: true }, text)
                press('s', { ctrlKey: true })

                expect(save).toHaveBeenCalledTimes(1)
            })

            it('still leaves the next key to the editor after a key pressed elsewhere, as the editor is still waiting', () => {
                const zoomReset = vi.fn()
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.appZoomReset': zoomReset, 'view.focusEditor': focusEditor })

                press('k', { ctrlKey: true }, text)
                press('ArrowDown')
                const ctrl0 = press('0', { ctrlKey: true }, text)

                expect(zoomReset).not.toHaveBeenCalled()
                expect(ctrl0.defaultPrevented).toBe(false)
                press('1', { ctrlKey: true }, text)
                expect(focusEditor).toHaveBeenCalledTimes(1)
            })

            it('gives the keys back to the app when the window loses focus, as the editor stops waiting then', () => {
                const save = vi.fn()
                const { text } = renderInDiagram({ 'document.save': save })

                press('k', { ctrlKey: true }, text)
                window.dispatchEvent(new Event('blur'))
                press('s', { ctrlKey: true }, text)

                expect(save).toHaveBeenCalledTimes(1)
            })

            it('takes Caps Lock as the second key, as the editor does', () => {
                const zoomReset = vi.fn()
                const { text } = renderInDiagram({ 'view.appZoomReset': zoomReset })

                press('k', { ctrlKey: true }, text)
                press('CapsLock', {}, text)
                press('0', { ctrlKey: true }, text)

                expect(zoomReset).toHaveBeenCalledTimes(1)
            })

            it('does not wait after a Ctrl+K the app took for Link', () => {
                const link = vi.fn()
                const focusEditor = vi.fn()
                renderHook(() => useGlobalKeybinds(bindings, { 'format.link': link, 'view.focusEditor': focusEditor }, { hasWorkspace: true }))
                const { text } = addEditor()

                press('k', { ctrlKey: true }, text)
                press('1', { ctrlKey: true }, text)

                expect(link).toHaveBeenCalledTimes(1)
                expect(focusEditor).toHaveBeenCalledTimes(1)
            })

            it('does not wait after Ctrl+Shift+K, which is a shortcut on its own', () => {
                const focusEditor = vi.fn()
                const { text } = renderInDiagram({ 'view.focusEditor': focusEditor })

                press('K', { ctrlKey: true, shiftKey: true }, text)
                press('1', { ctrlKey: true }, text)

                expect(focusEditor).toHaveBeenCalledTimes(1)
            })
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
