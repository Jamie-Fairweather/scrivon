import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { escapeLeavesFocusMode, escapeSnapshot, useLeaveFocusModeOnEscape, type EscapeKey } from './focus-mode-escape'

const NOTHING_OPEN = { popupOpen: false, editorHoverShown: false }

function esc(overrides: Partial<EscapeKey> = {}): EscapeKey {
    return { key: 'Escape', defaultPrevented: false, target: document.body, ...overrides }
}

/** An element inside `html`, added to the page, found by `selector`. */
function inside(html: string, selector: string): Element {
    document.body.innerHTML = html
    return document.querySelector(selector)!
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('escapeLeavesFocusMode', () => {
    it('leaves on a plain Esc that nothing else used, wherever focus is', () => {
        expect(escapeLeavesFocusMode(esc(), NOTHING_OPEN)).toBe(true)
        const editor = inside('<div data-pane="editor" tabindex="-1"><textarea></textarea></div>', 'textarea')
        expect(escapeLeavesFocusMode(esc({ target: editor }), NOTHING_OPEN)).toBe(true)
    })

    it('ignores other keys, and Esc with a modifier or held down', () => {
        expect(escapeLeavesFocusMode(esc({ key: 'F11' }), NOTHING_OPEN)).toBe(false)
        expect(escapeLeavesFocusMode(esc({ key: 'Esc' }), NOTHING_OPEN)).toBe(false)
        for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'] as const) {
            expect(escapeLeavesFocusMode(esc({ [modifier]: true }), NOTHING_OPEN), modifier).toBe(false)
        }
        expect(escapeLeavesFocusMode(esc({ repeat: true }), NOTHING_OPEN)).toBe(false)
    })

    // Monaco marks Esc as used when one of its own Escape commands runs: clearing a selection or multiple cursors,
    // leaving a snippet, closing find, suggestions, parameter hints, the quick-fix list or the F8 problem widget.
    it('leaves Esc to the editor when the editor used it', () => {
        expect(escapeLeavesFocusMode(esc({ defaultPrevented: true }), NOTHING_OPEN)).toBe(false)
    })

    it('leaves Esc to an input method that is composing', () => {
        expect(escapeLeavesFocusMode(esc({ isComposing: true }), NOTHING_OPEN)).toBe(false)
        expect(escapeLeavesFocusMode(esc({ keyCode: 229 }), NOTHING_OPEN)).toBe(false)
        expect(escapeLeavesFocusMode(esc({ key: 'Process' }), NOTHING_OPEN)).toBe(false)
    })

    it("leaves Esc to Monaco's hover, which hides on any key without saying so", () => {
        expect(escapeLeavesFocusMode(esc(), { popupOpen: false, editorHoverShown: true })).toBe(false)
    })

    it('leaves Esc to an open menu, palette or dialog', () => {
        expect(escapeLeavesFocusMode(esc(), { popupOpen: true, editorHoverShown: false })).toBe(false)
    })

    it.each([
        ['a dialog', '<div role="dialog"><button>OK</button></div>'],
        ['a confirmation', '<div role="alertdialog"><button>OK</button></div>'],
        ['a menu', '<div role="menu"><button>OK</button></div>'],
        ['the menu bar', '<div role="menubar"><button>OK</button></div>'],
        ['a list', '<div role="listbox"><button>OK</button></div>'],
        ["Monaco's find box", '<div class="monaco-editor"><div class="find-widget" role="dialog"><button>OK</button></div></div>'],
    ])('leaves Esc to %s that has focus', (_, html) => {
        expect(escapeLeavesFocusMode(esc({ target: inside(html, 'button') }), NOTHING_OPEN)).toBe(false)
    })
})

describe('escapeSnapshot', () => {
    it('sees nothing open on a plain page', () => {
        document.body.innerHTML = '<main><textarea></textarea></main>'
        expect(escapeSnapshot(document)).toEqual(NOTHING_OPEN)
    })

    it.each([
        ['the palette or a dialog', '<div role="dialog" data-open></div>'],
        ['a confirmation', '<div role="alertdialog" data-open></div>'],
        ['a menu', '<div role="menu" data-open></div>'],
        ['a list', '<div role="listbox" data-open></div>'],
    ])('sees %s open', (_, html) => {
        document.body.innerHTML = html
        expect(escapeSnapshot(document).popupOpen).toBe(true)
    })

    it("doesn't count a notification, or Monaco's find box, as open", () => {
        document.body.innerHTML = '<div role="dialog" aria-modal="false" data-open></div><div class="find-widget" role="dialog"></div>'
        expect(escapeSnapshot(document).popupOpen).toBe(false)
    })

    it("sees Monaco's hover only while it shows", () => {
        document.body.innerHTML = '<div class="monaco-editor"><div class="monaco-hover hidden"></div></div>'
        expect(escapeSnapshot(document).editorHoverShown).toBe(false)
        document.querySelector('.monaco-hover')!.classList.remove('hidden')
        expect(escapeSnapshot(document).editorHoverShown).toBe(true)
    })
})

describe('useLeaveFocusModeOnEscape', () => {
    function press(target: EventTarget, init: KeyboardEventInit = {}) {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        return event
    }

    it('leaves on Esc from anywhere while active, and marks the key as used', () => {
        const leave = vi.fn()
        renderHook(() => useLeaveFocusModeOnEscape(true, leave))

        const event = press(document.body)
        expect(leave).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
    })

    it('does nothing while inactive', () => {
        const leave = vi.fn()
        renderHook(() => useLeaveFocusModeOnEscape(false, leave))
        press(document.body)
        expect(leave).not.toHaveBeenCalled()
    })

    it('leaves Esc alone when something below used it first', () => {
        const leave = vi.fn()
        renderHook(() => useLeaveFocusModeOnEscape(true, leave))
        const editor = inside('<div class="monaco-editor"><textarea></textarea></div>', 'textarea')
        editor.addEventListener('keydown', (event) => event.preventDefault())

        press(editor)
        expect(leave).not.toHaveBeenCalled()
    })

    it('leaves Esc to a menu that closes as the key reaches it', () => {
        const leave = vi.fn()
        renderHook(() => useLeaveFocusModeOnEscape(true, leave))
        const menu = inside('<div role="menu" data-open></div><textarea></textarea>', '[role="menu"]')
        const textarea = document.querySelector('textarea')!
        // As Base UI does: the menu closes on Esc before the key bubbles up to the window.
        textarea.addEventListener('keydown', () => menu.removeAttribute('data-open'))

        press(textarea)
        expect(leave).not.toHaveBeenCalled()
    })

    it('stops listening once unmounted', () => {
        const leave = vi.fn()
        const { unmount } = renderHook(() => useLeaveFocusModeOnEscape(true, leave))
        unmount()
        press(document.body)
        expect(leave).not.toHaveBeenCalled()
    })
})
