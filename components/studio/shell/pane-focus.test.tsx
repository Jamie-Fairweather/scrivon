import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEditorFocusNow } from '@/components/studio/editor/editor-focus'
import { useGlobalKeybinds } from '@/components/studio/hooks/use-global-keybinds'
import { cyclePaneFocus, cyclePaneFocusSoon, focusPane, focusPaneSoon } from '@/components/studio/shell/pane-focus'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ToastProvider } from '@/components/ui/toast'
import { dismissNotification, notifyError } from '@/lib/notify'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

/**
 * The command palette, after every pane like Base UI's portal. It takes focus when it opens. Once a command is picked
 * it fades out (data-closed) for a while, then gives focus back to where it was, as Base UI does.
 */
function Palette({ closing }: { closing: boolean }) {
    const popupRef = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const popup = popupRef.current!
        const returnTo = document.activeElement as HTMLElement | null
        popup.querySelector('input')!.focus()
        return () => {
            if (popup.contains(document.activeElement)) returnTo?.focus()
        }
    }, [])
    return (
        <div ref={popupRef} role="dialog" aria-label="Command palette" data-open={closing ? undefined : ''} data-closed={closing ? '' : undefined}>
            <input aria-label="Search commands" />
        </div>
    )
}

/** A layout like the studio's: explorer, outline, a tab bar, editor and preview, in screen order. */
function Panes({ outline = true, editorInert = false, palette }: { outline?: boolean; editorInert?: boolean; palette?: 'open' | 'closing' }) {
    return (
        <div>
            <button type="button">Menu</button>
            <aside data-pane="explorer">
                <button type="button">Files</button>
                <div data-pane-focus>
                    <div role="treeitem" aria-selected={false} tabIndex={-1} aria-label="a.md" />
                    <div role="treeitem" aria-selected={false} tabIndex={0} aria-label="b.md" />
                </div>
            </aside>
            {outline && (
                <aside data-pane="outline">
                    <button type="button">Hide Outline</button>
                </aside>
            )}
            <main>
                <button type="button">Tab</button>
                <div data-pane="editor" inert={editorInert || undefined}>
                    <textarea aria-label="Editor" />
                </div>
                <div data-pane="preview" role="region" aria-label="Preview" tabIndex={-1}>
                    <p>Nothing here can take focus.</p>
                </div>
            </main>
            <footer>
                <button type="button">Status</button>
            </footer>
            {palette && <Palette closing={palette === 'closing'} />}
        </div>
    )
}

const focused = () => document.activeElement

/** Animation frames run by hand, `ms` apart, like a screen with that refresh rate. */
function framesEvery(ms: number) {
    let now = 0
    let waiting: FrameRequestCallback[] = []
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        waiting.push(callback)
        return waiting.length
    })
    return {
        run(count: number) {
            for (let frame = 0; frame < count; frame++) {
                now += ms
                const due = waiting
                waiting = []
                for (const callback of due) callback(now)
            }
        },
    }
}

/** Stands in for the editor panel: focuses its text box while it is shown. */
function registerFakeEditor() {
    return registerEditorFocusNow(() => {
        const input = document.querySelector<HTMLElement>('[data-pane="editor"]:not([inert]) textarea')
        input?.focus()
        return input !== null
    })
}

let unregisterEditor = () => {}

beforeEach(() => {
    unregisterEditor = registerFakeEditor()
})

afterEach(() => {
    vi.restoreAllMocks()
    unregisterEditor()
    ;(document.activeElement as HTMLElement | null)?.blur()
})

describe('cyclePaneFocus', () => {
    it('moves to the next visible pane, and wraps round', () => {
        render(<Panes />)
        screen.getByRole('treeitem', { name: 'b.md' }).focus()

        expect(cyclePaneFocus(1)).toBe(true)
        expect(focused()).toBe(screen.getByRole('button', { name: 'Hide Outline' }))
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
    })

    it('moves to the previous pane with -1', () => {
        render(<Panes />)
        screen.getByRole('treeitem', { name: 'b.md' }).focus()

        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))
    })

    it('skips panes that are closed or hidden', () => {
        render(<Panes outline={false} editorInert />)
        screen.getByRole('treeitem', { name: 'b.md' }).focus()

        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
    })

    it('starts from where focus is when it is outside every pane', () => {
        render(<Panes />)

        screen.getByRole('button', { name: 'Tab' }).focus()
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))

        screen.getByRole('button', { name: 'Tab' }).focus()
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('button', { name: 'Hide Outline' }))

        screen.getByRole('button', { name: 'Status' }).focus()
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
    })

    it('goes to the first pane, or the last, when nothing has focus', () => {
        render(<Panes />)

        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
        ;(document.activeElement as HTMLElement).blur()
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it('moves on past a pane where nothing will take focus', () => {
        render(<Panes />)
        // Like a link in a closed <details>: it is a Tab stop, but the browser won't focus it.
        vi.spyOn(screen.getByRole('button', { name: 'Hide Outline' }), 'focus').mockImplementation(() => {})
        screen.getByRole('treeitem', { name: 'b.md' }).focus()

        expect(cyclePaneFocus(1)).toBe(true)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))
    })

    it('does nothing when no pane is shown', () => {
        render(<button type="button">Alone</button>)
        screen.getByRole('button', { name: 'Alone' }).focus()

        expect(cyclePaneFocus(1)).toBe(false)
        expect(focused()).toBe(screen.getByRole('button', { name: 'Alone' }))
    })
})

describe('cyclePaneFocus with notifications', () => {
    const NOTICE = 'save-failed'

    afterEach(() => {
        act(() => dismissNotification(NOTICE))
    })

    /** Like "Couldn't save": it never times out, and its Try Again may be the only way to retry. */
    async function showSaveFailed(tryAgain = vi.fn()) {
        act(() => {
            notifyError("Couldn't save b.md", undefined, { id: NOTICE, timeout: 0, action: { label: 'Try Again', onClick: tryAgain } })
        })
        // Hidden from screen readers (aria-hidden) until the notifications have focus.
        await screen.findByRole('button', { name: 'Try Again', hidden: true })
    }

    it('stops at the notifications last while one shows, and Tab from there reaches its buttons', async () => {
        const user = userEvent.setup()
        render(
            <ToastProvider>
                <Panes />
            </ToastProvider>
        )
        await showSaveFailed()
        const notifications = screen.getByRole('region', { name: 'Notifications' })

        screen.getByRole('region', { name: 'Preview' }).focus()
        expect(cyclePaneFocus(1)).toBe(true)
        expect(focused()).toBe(notifications)

        await user.tab()
        await user.tab()
        expect(focused()).toBe(screen.getByRole('button', { name: 'Try Again' }))

        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
        cyclePaneFocus(-1)
        expect(focused()).toBe(notifications)
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it("goes back to where focus was when a notification's button closes it", async () => {
        const user = userEvent.setup()
        // The save works this time, so the notice goes.
        const tryAgain = vi.fn(() => dismissNotification(NOTICE))
        render(
            <ToastProvider>
                <Panes />
            </ToastProvider>
        )
        await showSaveFailed(tryAgain)
        const preview = screen.getByRole('region', { name: 'Preview' })

        preview.focus()
        cyclePaneFocus(1)
        await user.tab()
        await user.tab()
        expect(focused()).toBe(screen.getByRole('button', { name: 'Try Again' }))
        await user.keyboard('{Enter}')

        expect(tryAgain).toHaveBeenCalled()
        expect(focused()).toBe(preview)
    })

    it('goes back to where focus was on Shift+Tab from the notifications', async () => {
        const user = userEvent.setup()
        render(
            <ToastProvider>
                <Panes />
            </ToastProvider>
        )
        await showSaveFailed()
        const file = screen.getByRole('treeitem', { name: 'b.md' })

        // Shift+F6 from the first pane goes back round to the notifications.
        file.focus()
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Notifications' }))
        await user.tab({ shift: true })

        expect(focused()).toBe(file)
    })

    it('goes back to where focus was on Tab past the last button', async () => {
        const user = userEvent.setup()
        render(
            <ToastProvider>
                <Panes />
            </ToastProvider>
        )
        await showSaveFailed()
        const preview = screen.getByRole('region', { name: 'Preview' })

        preview.focus()
        cyclePaneFocus(1)
        await user.tab()
        await user.tab()
        await user.tab()
        expect(focused()).toBe(screen.getByRole('button', { name: 'Dismiss notification' }))
        await user.tab()

        expect(focused()).toBe(preview)
    })

    it('works with the real F6 key and the app shortcut handler', async () => {
        const keybinds = createDefaultKeybinds(false)
        const handlers = { 'view.focusNextPane': () => cyclePaneFocusSoon(1), 'view.focusPreviousPane': () => cyclePaneFocusSoon(-1) }
        function Shortcuts() {
            useGlobalKeybinds(keybinds, handlers, { hasWorkspace: true })
            return null
        }
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
        const user = userEvent.setup()
        render(
            <ToastProvider>
                <Panes />
                <Shortcuts />
            </ToastProvider>
        )
        await showSaveFailed()
        const preview = screen.getByRole('region', { name: 'Preview' })
        const notifications = screen.getByRole('region', { name: 'Notifications' })

        preview.focus()
        await user.keyboard('{F6}')
        await waitFor(() => expect(focused()).toBe(notifications))
        // And it stays there: the F6 sent for Base UI doesn't count as another press.
        for (let frame = 0; frame < 3; frame++) await nextFrame()
        expect(focused()).toBe(notifications)

        await user.tab({ shift: true })
        expect(focused()).toBe(preview)
    })

    it("still focuses the notifications when Base UI doesn't hear the app's F6", async () => {
        // Like a Base UI update that stops listening for F6 on the window: a listener ahead of it swallows the key.
        const swallowF6 = (event: KeyboardEvent) => {
            if (event.key === 'F6') event.stopImmediatePropagation()
        }
        window.addEventListener('keydown', swallowF6, { capture: true })
        try {
            render(
                <ToastProvider>
                    <Panes />
                </ToastProvider>
            )
            await showSaveFailed()

            screen.getByRole('region', { name: 'Preview' }).focus()
            expect(cyclePaneFocus(1)).toBe(true)
            expect(focused()).toBe(screen.getByRole('region', { name: 'Notifications' }))
        } finally {
            window.removeEventListener('keydown', swallowF6, { capture: true })
        }
    })

    it('skips the notifications while none shows', async () => {
        render(
            <ToastProvider>
                <Panes />
            </ToastProvider>
        )
        await showSaveFailed()
        act(() => dismissNotification(NOTICE))
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Try Again', hidden: true })).toBeNull())

        screen.getByRole('region', { name: 'Preview' }).focus()
        cyclePaneFocus(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
        cyclePaneFocus(-1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })
})

describe('focusPane', () => {
    it("goes to the pane's main part first: the file tree's tab stop, not the buttons above it", () => {
        render(<Panes />)

        expect(focusPane('explorer')).toBe(true)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
    })

    it('falls back to the first thing in the pane that can take focus, then to the pane itself', () => {
        render(
            <>
                <aside data-pane="explorer">
                    <button type="button" tabIndex={-1}>
                        Out of the Tab order
                    </button>
                    <button type="button">Files</button>
                    <div data-pane-focus>
                        <p>No files in this folder.</p>
                    </div>
                </aside>
                <div data-pane="preview" role="region" aria-label="Preview" tabIndex={-1} />
            </>
        )

        focusPane('explorer')
        expect(focused()).toBe(screen.getByRole('button', { name: 'Files' }))
        focusPane('preview')
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it('tries the next thing in the pane when the first will not take focus', () => {
        render(<Panes />)
        vi.spyOn(screen.getByRole('treeitem', { name: 'b.md' }), 'focus').mockImplementation(() => {})

        expect(focusPane('explorer')).toBe(true)
        expect(focused()).toBe(screen.getByRole('button', { name: 'Files' }))
    })

    it('goes to the preview scroll box when it scrolls, else to the preview itself, never into the page', () => {
        function Preview({ scrolls = false, expanded = false }: { scrolls?: boolean; expanded?: boolean }) {
            return (
                <div data-pane="preview" role="region" aria-label="Preview" tabIndex={-1}>
                    <button type="button">Load images</button>
                    {/* A box marked like the explorer's. The preview only takes data-pane-focus-self (the diagram canvas). */}
                    <div inert={expanded || undefined} data-pane-focus tabIndex={-1}>
                        <div data-slot="scroll-area-viewport" data-testid="scroll box" tabIndex={scrolls ? 0 : -1}>
                            <a href="#intro">Intro</a>
                        </div>
                    </div>
                </div>
            )
        }
        const { rerender } = render(<Preview />)

        expect(focusPane('preview')).toBe(true)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))

        rerender(<Preview scrolls />)
        focusPane('preview')
        expect(focused()).toBe(screen.getByTestId('scroll box'))

        // An expanded diagram covers the page, which is then inert.
        rerender(<Preview scrolls expanded />)
        focusPane('preview')
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it('focuses the editor through the editor panel', () => {
        render(<Panes />)

        expect(focusPane('editor')).toBe(true)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))
    })

    it('says no for a pane that is closed, hidden or has nothing to focus', () => {
        render(
            <>
                <div data-pane="editor" inert>
                    <textarea aria-label="Editor" />
                </div>
                <div data-pane="preview" />
            </>
        )

        expect(focusPane('outline')).toBe(false)
        expect(focusPane('editor')).toBe(false)
        expect(focusPane('preview')).toBe(false)
        expect(focused()).toBe(document.body)
    })
})

describe('focusing from a command', () => {
    it('waits a frame, so the menu or palette it came from has let go of focus', async () => {
        render(<Panes />)
        const tab = screen.getByRole('button', { name: 'Tab' })
        tab.focus()

        cyclePaneFocusSoon(1)
        expect(focused()).toBe(tab)
        await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' })))

        focusPaneSoon('preview')
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' }))
        await waitFor(() => expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' })))
    })

    it('waits while the palette fades out, then moves on from the pane that had focus before it opened', async () => {
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
        const search = () => screen.getByRole('textbox', { name: 'Search commands' })
        const { rerender } = render(<Panes />)
        screen.getByRole('textbox', { name: 'Editor' }).focus()

        // Focus Next Pane, picked from the palette: it closes, then runs the command.
        rerender(<Panes palette="open" />)
        rerender(<Panes palette="closing" />)
        cyclePaneFocusSoon(1)
        for (let frame = 0; frame < 5; frame++) await nextFrame()
        expect(focused()).toBe(search())
        rerender(<Panes />)
        await waitFor(() => expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' })))

        // And Focus Previous Pane.
        rerender(<Panes palette="open" />)
        rerender(<Panes palette="closing" />)
        cyclePaneFocusSoon(-1)
        for (let frame = 0; frame < 5; frame++) await nextFrame()
        expect(focused()).toBe(search())
        rerender(<Panes />)
        await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' })))
    })

    it('waits by time, so a high-refresh screen does not cut the wait short', () => {
        const frames = framesEvery(1000 / 240)
        const { rerender } = render(<Panes />)
        screen.getByRole('textbox', { name: 'Editor' }).focus()
        rerender(<Panes palette="open" />)
        rerender(<Panes palette="closing" />)

        cyclePaneFocusSoon(1)
        frames.run(60) // 250 ms: more than the palette's 200 ms fade-out.
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Search commands' }))
        rerender(<Panes />)
        frames.run(1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it('stops waiting after half a second when the palette never gives focus back', () => {
        const frames = framesEvery(10)
        render(<Panes palette="closing" />)

        cyclePaneFocusSoon(1)
        frames.run(49)
        expect(focused()).toBe(screen.getByRole('textbox', { name: 'Search commands' }))
        frames.run(1)
        expect(focused()).toBe(screen.getByRole('treeitem', { name: 'b.md' }))
    })

    it("doesn't wait in a closed Collapsible, which Base UI also marks data-closed", () => {
        const frames = framesEvery(10)
        render(
            <>
                <aside data-pane="explorer">
                    <Collapsible>
                        <CollapsibleTrigger>Flowcharts</CollapsibleTrigger>
                        <CollapsiblePanel>Examples</CollapsiblePanel>
                    </Collapsible>
                </aside>
                <div data-pane="preview" role="region" aria-label="Preview" tabIndex={-1} />
            </>
        )
        const trigger = screen.getByRole('button', { name: 'Flowcharts' })
        trigger.focus()
        expect(trigger.closest('[data-closed]')).not.toBeNull()

        cyclePaneFocusSoon(1)
        frames.run(1)
        expect(focused()).toBe(screen.getByRole('region', { name: 'Preview' }))
    })

    it('keeps trying while a pane that was just shown appears', async () => {
        const { rerender } = render(<Panes editorInert />)

        focusPaneSoon('editor')
        await new Promise((resolve) => requestAnimationFrame(resolve))
        rerender(<Panes />)

        await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: 'Editor' })))
    })
})
