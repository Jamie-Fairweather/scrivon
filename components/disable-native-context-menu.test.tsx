import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DisableNativeContextMenu } from './disable-native-context-menu'

/** Right-clicks `target` and says whether the webview's own menu would still open. */
function rightClick(target: Element): { nativeMenu: boolean } {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return { nativeMenu: !event.defaultPrevented }
}

function renderPage() {
    return render(
        <>
            <DisableNativeContextMenu />
            <input aria-label="Name" />
            <input aria-label="Search" type="search" />
            <input aria-label="Agree" type="checkbox" />
            <textarea aria-label="Notes" />
            <div aria-label="Editable" contentEditable suppressContentEditableWarning>
                <span>typed text</span>
            </div>
            <article>
                <p>Preview text you can copy</p>
                <p>Another paragraph</p>
            </article>
            <div>Plain area</div>
        </>
    )
}

describe('DisableNativeContextMenu', () => {
    afterEach(() => {
        window.getSelection()?.removeAllRanges()
    })

    it('keeps Cut, Copy and Paste in text fields', () => {
        renderPage()

        expect(rightClick(screen.getByLabelText('Name'))).toEqual({ nativeMenu: true })
        expect(rightClick(screen.getByLabelText('Search'))).toEqual({ nativeMenu: true })
        expect(rightClick(screen.getByLabelText('Notes'))).toEqual({ nativeMenu: true })
        expect(rightClick(screen.getByText('typed text'))).toEqual({ nativeMenu: true })
    })

    it('turns the menu off everywhere else, including inputs that hold no text', () => {
        renderPage()

        expect(rightClick(screen.getByText('Plain area'))).toEqual({ nativeMenu: false })
        expect(rightClick(screen.getByText('Preview text you can copy'))).toEqual({ nativeMenu: false })
        expect(rightClick(screen.getByLabelText('Agree'))).toEqual({ nativeMenu: false })
    })

    it('keeps Copy for a right-click on selected text, but not elsewhere while text is selected', () => {
        renderPage()
        const paragraph = screen.getByText('Preview text you can copy')
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        window.getSelection()!.addRange(range)

        expect(rightClick(paragraph)).toEqual({ nativeMenu: true })
        expect(rightClick(screen.getByText('Another paragraph'))).toEqual({ nativeMenu: false })
        expect(rightClick(screen.getByText('Plain area'))).toEqual({ nativeMenu: false })
    })

    it('stops listening once it is gone', () => {
        const { unmount } = renderPage()
        const area = screen.getByText('Plain area')
        const target = document.body.appendChild(document.createElement('div'))
        unmount()

        expect(area.isConnected).toBe(false)
        expect(rightClick(target)).toEqual({ nativeMenu: true })
        target.remove()
    })
})
