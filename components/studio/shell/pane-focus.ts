import { focusEditorNow } from '@/components/studio/editor/editor-focus'
import { sendKeyPastShortcuts } from '@/components/studio/hooks/use-global-keybinds'

/** The panes F6 moves between. They are found by their data-pane attribute, in screen order. */
export type PaneId = 'explorer' | 'outline' | 'editor' | 'preview'

/**
 * Inside a pane, the part focus goes to first, such as the file tree rather than the buttons above it.
 * Without one (or when nothing in it can take focus), focus goes to the first thing in the pane that can,
 * else to the pane itself when it has a tabIndex.
 */
const PANE_FOCUS_ATTRIBUTE = 'data-pane-focus'

/** In the preview, an element that takes focus itself, not the first Tab stop inside it: the diagram canvas. */
const PANE_FOCUS_SELF_ATTRIBUTE = 'data-pane-focus-self'

/** What Tab stops on: links, enabled controls and elements with a tabIndex, but not those taken out of the Tab order. */
const TABBABLE = ['a[href]', 'button:not(:disabled)', 'input:not(:disabled)', 'select:not(:disabled)', 'textarea:not(:disabled)', '[tabindex]']
    .map((selector) => `${selector}:not([tabindex^="-"])`)
    .join(', ')

/** A closed pane is not in the page. A hidden one is `inert` or `hidden` (the editor stays mounted when hidden). */
function isShown(element: Element): boolean {
    return element.isConnected && element.closest('[inert], [hidden]') === null
}

function tabbables(root: Element): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(isShown)
}

/** The notifications (Base UI's toast viewport). Its own F6 shortcut can't run while ours takes the key. */
const NOTIFICATIONS = '[data-slot="toast-viewport"]'

/** A notification that is showing, not one animating out. Base UI makes each one a non-modal dialog. */
const SHOWING_NOTIFICATION = ':is([role="dialog"], [role="alertdialog"]):not([data-ending-style])'

/** The notifications, while one shows: the last stop for F6, after the panes. */
function shownNotifications(doc: Document): HTMLElement[] {
    const region = doc.querySelector<HTMLElement>(NOTIFICATIONS)
    const showing = region !== null && isShown(region) && [...region.querySelectorAll(SHOWING_NOTIFICATION)].some(isShown)
    return showing ? [region] : []
}

function shownPanes(doc: Document): HTMLElement[] {
    return [...doc.querySelectorAll<HTMLElement>('[data-pane]')].filter(isShown)
}

/** Focuses the element, and says whether focus really landed there (a link in a closed `<details>` can't take it). */
function tryFocus(element: HTMLElement): boolean {
    element.focus()
    return element.ownerDocument.activeElement === element
}

/** The pane itself, when it has a tabIndex. */
function paneItself(pane: HTMLElement): HTMLElement[] {
    return pane.hasAttribute('tabindex') ? [pane] : []
}

/** Where focus may go in a pane, best first. */
function focusTargets(pane: HTMLElement): HTMLElement[] {
    if (pane.dataset.pane === 'preview') {
        // A diagram's canvas itself (marked data-pane-focus-self), so its zoom and arrow keys work: a Mermaid tab's, or
        // the full-size one over a Markdown page. Else the scroll box when it scrolls, else the preview itself: never a
        // link or button partway down the page.
        const canvas = [...pane.querySelectorAll<HTMLElement>(`[${PANE_FOCUS_SELF_ATTRIBUTE}]`)].filter(isShown)
        const viewport = pane.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
        const scrolls = viewport !== null && viewport.tabIndex >= 0 && isShown(viewport)
        return [...canvas, ...(scrolls ? [viewport] : []), ...paneItself(pane)]
    }
    const preferred = pane.querySelector(`[${PANE_FOCUS_ATTRIBUTE}]`)
    return [...(preferred ? tabbables(preferred) : []), ...tabbables(pane), ...paneItself(pane)]
}

/**
 * Moves focus to the notifications with Base UI's own F6, so it remembers where focus was. Closing a notification
 * with its button, Tab past the last one, or Shift+Tab on the region then goes back there. Base UI listens for F6 on
 * the window, but our shortcut handler takes the real key first, so we send the window an F6 of our own.
 */
function focusNotifications(region: HTMLElement): boolean {
    const win = region.ownerDocument.defaultView
    if (win) sendKeyPastShortcuts(win, { key: 'F6' })
    // If Base UI didn't move focus (it only listens while a notification shows), focus the region ourselves.
    return region.ownerDocument.activeElement === region || tryFocus(region)
}

/** Puts focus in the pane now. False when nothing in it can take focus (the editor with no file open, say). */
function focusInPane(pane: HTMLElement): boolean {
    // Monaco takes focus through its own API, which also brings back its cursor.
    if (pane.dataset.pane === 'editor') return focusEditorNow()
    if (pane.matches(NOTIFICATIONS)) return focusNotifications(pane)
    return focusTargets(pane).some(tryFocus)
}

/** The panes in the order F6 (1) or Shift+F6 (-1) tries them: from the one after (or before) focus, round to the one it is in. */
function cycleOrder(panes: HTMLElement[], active: Element | null, direction: 1 | -1): HTMLElement[] {
    const count = panes.length
    const current = active ? panes.findIndex((pane) => pane.contains(active)) : -1
    let start: number
    if (current >= 0) {
        start = current + direction
    } else {
        // Outside every pane (the tab bar, the status bar, nothing): the next pane after it on screen, or the one before.
        const following = active ? panes.findIndex((pane) => active.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING) : 0
        const next = following === -1 ? count : following
        start = direction === 1 ? next : next - 1
    }
    return panes.map((_, i) => panes[(((start + i * direction) % count) + count) % count]!)
}

/** Focus Explorer, Focus Editor, Focus Preview. False when that pane is closed, hidden or has nothing to focus. */
export function focusPane(id: PaneId, doc: Document = document): boolean {
    const pane = shownPanes(doc).find((element) => element.dataset.pane === id)
    return pane ? focusInPane(pane) : false
}

/**
 * F6 and Shift+F6: moves focus to the next (1) or previous (-1) pane on screen, skipping closed and hidden ones.
 * While a notification shows, the notifications are a stop too, after the last pane.
 */
export function cyclePaneFocus(direction: 1 | -1, doc: Document = document): boolean {
    const panes = [...shownPanes(doc), ...shownNotifications(doc)]
    if (panes.length === 0) return false
    return cycleOrder(panes, doc.activeElement, direction).some(focusInPane)
}

/** How many frames Focus Explorer and the like keep trying while a pane they just showed appears. */
const FOCUS_TRIES = 10

/**
 * focusPane for a command: a frame later, so the menu or palette it was picked from has let go of focus, and
 * again on the next frames (a few) while a pane it just showed appears.
 */
export function focusPaneSoon(id: PaneId): void {
    let tries = FOCUS_TRIES
    const attempt = () => {
        if (!focusPane(id) && --tries > 0) requestAnimationFrame(attempt)
    }
    requestAnimationFrame(attempt)
}

/** How long a command waits for a closing palette or menu to give focus back. The palette fades out for 200 ms. */
const CLOSE_WAIT_MS = 500

/**
 * A palette, menu or dialog that is closing: Base UI marks it data-closed while it fades out. Not any data-closed,
 * since a closed Collapsible (an Examples category) has it too.
 */
const CLOSING_POPUP = ':is([role="dialog"], [role="alertdialog"], [role="menu"])[data-closed]'

/**
 * cyclePaneFocus for a command, once the menu or palette it was picked from has given focus back, so it moves on from
 * the pane that had focus before. That's a frame later, or longer for the palette: it keeps focus while it fades out.
 */
export function cyclePaneFocusSoon(direction: 1 | -1): void {
    // Timed, not counted in frames: a high-refresh screen draws more frames in the same time.
    const giveUpAt = performance.now() + CLOSE_WAIT_MS
    const attempt = () => {
        const closing = document.activeElement?.closest(CLOSING_POPUP)
        if (closing && performance.now() < giveUpAt) requestAnimationFrame(attempt)
        else cyclePaneFocus(direction)
    }
    requestAnimationFrame(attempt)
}
