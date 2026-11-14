import type { IDisposable, IPosition, editor } from 'monaco-editor'

/** Where the editor's right-click menu opens, and the place in the file it is for. */
export type EditorContextMenuRequest = {
    /** In the window's coordinates: at the mouse, or just under the caret. */
    point: { x: number; y: number }
    /** Where the mouse was in the text, or the caret. */
    position: IPosition
}

type MenuEditor = Pick<
    editor.ICodeEditor,
    | 'getContainerDomNode'
    | 'getDomNode'
    | 'getModel'
    | 'getTargetAtClientPoint'
    | 'getPosition'
    | 'setPosition'
    | 'getSelections'
    | 'focus'
    | 'revealPosition'
    | 'render'
    | 'getScrolledVisiblePosition'
    | 'onKeyDown'
>

/** Monaco's MouseTargetType for the text and the empty space beside it. The enum's values only exist inside Monaco. */
const CONTENT_TEXT = 6
const CONTENT_EMPTY = 7

/**
 * Calls `open` when the editor's right-click menu should open. Monaco's own menu must be off (its contextmenu
 * option). A right-click in the text opens it at the mouse, with the caret moved there first unless the click
 * is inside the selection, as Monaco does. Shift+F10 and the Menu key open it under the caret. The find box keeps
 * the system menu, for its Cut, Copy and Paste. Dispose with the editor.
 */
export function listenForEditorContextMenu(editorInstance: MenuEditor, open: (request: EditorContextMenuRequest) => void): IDisposable {
    const openAtCaret = () => {
        const position = editorInstance.getPosition()
        const view = editorInstance.getDomNode()
        if (!position || !view) return
        editorInstance.revealPosition(position)
        // Lays out the line first, or a caret just scrolled into view has no place yet.
        editorInstance.render()
        const caret = editorInstance.getScrolledVisiblePosition(position)
        if (!caret) return
        const box = view.getBoundingClientRect()
        open({ point: { x: box.left + caret.left, y: box.top + caret.top + caret.height }, position })
    }

    const onContextMenu = (event: MouseEvent) => {
        const target = event.target
        if (!(target instanceof Element) || !editorInstance.getModel()) return
        // Monaco would take the keyboard from the find box, even with its own menu off.
        if (target.closest('.overlayWidgets')) {
            event.stopPropagation()
            return
        }
        // Nor may Monaco see the rest: with its own menu off it still moves the caret, also for the keyboard.
        event.preventDefault()
        event.stopPropagation()
        // Shift+F10 and the Menu key go to what has focus. A click goes to what is under the mouse, and that is never
        // Monaco's own text input: it sits behind the text.
        if (target === document.activeElement) {
            openAtCaret()
            return
        }
        const hit = editorInstance.getTargetAtClientPoint(event.clientX, event.clientY)
        const clicked = hit?.position
        if (!clicked || (hit.type !== CONTENT_TEXT && hit.type !== CONTENT_EMPTY)) return
        editorInstance.focus()
        if (!editorInstance.getSelections()?.some((selection) => selection.containsPosition(clicked))) editorInstance.setPosition(clicked)
        open({ point: { x: event.clientX, y: event.clientY }, position: clicked })
    }

    const container = editorInstance.getContainerDomNode()
    // On the editor's outer box, so it comes before Monaco's own listener inside.
    container.addEventListener('contextmenu', onContextMenu, { capture: true })
    // Monaco's own Shift+F10 opens its menu, which is off, so the key would do nothing. This runs before Monaco's
    // keybindings see the key.
    const keys = editorInstance.onKeyDown((e) => {
        if (e.browserEvent.key !== 'F10' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
        e.preventDefault()
        e.stopPropagation()
        openAtCaret()
    })
    return {
        dispose: () => {
            container.removeEventListener('contextmenu', onContextMenu, { capture: true })
            keys.dispose()
        },
    }
}
