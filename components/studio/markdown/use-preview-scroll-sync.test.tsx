import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorPreviewSync, PreviewSide } from './editor-preview-sync'
import { usePreviewScrollSync } from './use-preview-scroll-sync'

function fakeSync() {
    const sides: PreviewSide[] = []
    const unregister = vi.fn()
    const sync: EditorPreviewSync = {
        registerEditor: vi.fn(() => () => {}),
        registerPreview: vi.fn((side: PreviewSide) => {
            sides.push(side)
            return unregister
        }),
        touched: vi.fn(),
        scrolled: vi.fn(),
        previewChanged: vi.fn(),
        jumpToLine: vi.fn(() => true),
    }
    return { sync, unregister, side: () => sides[sides.length - 1]! }
}

/** A preview whose viewport sits 50px down the window, scrolled by 200px. Blocks give their place in `data-top`. */
function Preview({ tabId, text, sync }: { tabId: string | null; text: string; sync: EditorPreviewSync }) {
    const rootRef = useRef<HTMLDivElement>(null)
    usePreviewScrollSync(rootRef, tabId, text, sync)
    return (
        <div ref={rootRef}>
            <div data-slot="scroll-area-viewport" data-testid="viewport">
                <article>
                    <h1 data-source-line="5" data-top="0">
                        {text}
                    </h1>
                    <p data-source-line="7" data-top="120">
                        Some <em>words</em> and <a href="#x">a link</a>.
                    </p>
                    <details>
                        <p data-source-line="9">Hidden, so it takes no space.</p>
                    </details>
                    <ul data-top="300">
                        <li data-source-line="12" data-top="300">
                            <p data-source-line="12" data-top="300">
                                Item <button type="button">Copy</button>
                            </p>
                        </li>
                    </ul>
                </article>
            </div>
            <div data-testid="outside">Load images</div>
        </div>
    )
}

const VIEWPORT_TOP = 50
const SCROLLED = 200

function rectAt(top: number, height = 20) {
    return { top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

describe('usePreviewScrollSync', () => {
    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.dataset.slot === 'scroll-area-viewport') return rectAt(VIEWPORT_TOP, 600)
            const top = this.dataset.top
            // Where the block is on screen: its place in the content, less how far the preview is scrolled.
            return top === undefined ? ({ ...rectAt(0, 0), width: 0 } as DOMRect) : rectAt(VIEWPORT_TOP + Number(top) - SCROLLED)
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    function setup(tabId: string | null = 'a.md') {
        const fake = fakeSync()
        const view = render(<Preview tabId={tabId} text="Title" sync={fake.sync} />)
        const viewport = view.getByTestId('viewport')
        Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2000 })
        Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 600 })
        viewport.scrollTop = SCROLLED
        return { ...fake, view, viewport }
    }

    it('gives the sync each block and how far down the content it starts, leaving out hidden ones', () => {
        const { side } = setup()
        expect(side().tabId()).toBe('a.md')
        expect(side().blocks()).toEqual([
            { line: 5, top: 0 },
            { line: 7, top: 120 },
            { line: 12, top: 300 },
            { line: 12, top: 300 },
        ])
    })

    it('reads and sets how far the preview is scrolled', () => {
        const { side, viewport } = setup()
        expect(side().scrollTop()).toBe(SCROLLED)
        expect(side().maxScrollTop()).toBe(1400)
        side().setScrollTop(640)
        expect(viewport.scrollTop).toBe(640)
    })

    it('says when the preview scrolls, and when the user works in it', () => {
        const { sync, viewport, view } = setup()
        fireEvent.scroll(viewport)
        expect(sync.scrolled).toHaveBeenCalledWith('preview')

        for (const fire of [fireEvent.wheel, fireEvent.pointerDown, fireEvent.keyDown, fireEvent.touchStart]) {
            vi.mocked(sync.touched).mockClear()
            fire(view.getByText('words'))
            expect(sync.touched).toHaveBeenCalledWith('preview')
        }
    })

    it('jumps to the line of the block that was double-clicked', () => {
        const { sync, view } = setup()
        fireEvent.doubleClick(view.getByText('words'))
        expect(sync.jumpToLine).toHaveBeenCalledWith(7)
        fireEvent.doubleClick(view.getByText('Title'))
        expect(sync.jumpToLine).toHaveBeenLastCalledWith(5)
    })

    it('leaves a double-click on a link or button, or outside the document, to do its own thing', () => {
        const { sync, view } = setup()
        fireEvent.doubleClick(view.getByText('a link'))
        fireEvent.doubleClick(view.getByText('Copy'))
        fireEvent.doubleClick(view.getByTestId('outside'))
        expect(sync.jumpToLine).not.toHaveBeenCalled()
    })

    it('says when the content changes', () => {
        const { sync, view } = setup()
        vi.mocked(sync.previewChanged).mockClear()
        view.rerender(<Preview tabId="a.md" text="New title" sync={sync} />)
        expect(sync.previewChanged).toHaveBeenCalledTimes(1)
    })

    it('says when the content changes size, as a diagram is drawn above the place being read', () => {
        const observers: { callback: () => void; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = []
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observed: Element[] = []
                disconnect = vi.fn()
                constructor(public callback: () => void) {
                    observers.push(this)
                }
                observe(element: Element) {
                    this.observed.push(element)
                }
            }
        )
        try {
            const { sync, view } = setup()
            expect(observers.at(-1)!.observed).toEqual([view.container.querySelector('article')])
            vi.mocked(sync.previewChanged).mockClear()
            observers.at(-1)!.callback()
            expect(sync.previewChanged).toHaveBeenCalledTimes(1)

            view.rerender(<Preview tabId="a.md" text="New title" sync={sync} />)
            expect(observers[0]!.disconnect).toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('follows the tab the preview shows, and lets go when it goes away', () => {
        const { sync, side, view, viewport, unregister } = setup()
        view.rerender(<Preview tabId="b.md" text="Title" sync={sync} />)
        expect(side().tabId()).toBe('b.md')
        expect(unregister).toHaveBeenCalledTimes(1)

        view.unmount()
        expect(unregister).toHaveBeenCalledTimes(2)
        vi.mocked(sync.scrolled).mockClear()
        fireEvent.scroll(viewport)
        expect(sync.scrolled).not.toHaveBeenCalled()
    })
})
