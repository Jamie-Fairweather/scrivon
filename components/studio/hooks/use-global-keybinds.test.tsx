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

        const event = press('b', { ctrlKey: true })

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

        const event = press('b', { ctrlKey: true }, button)
        press('F1', {}, button)

        expect(toggleExplorer).not.toHaveBeenCalled()
        expect(openPalette).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
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
