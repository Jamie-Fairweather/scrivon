import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'
import type { PresentFullscreen } from './present-fullscreen'
import { PresentModeProvider, usePresentMode } from './present-mode-provider'
import { PresentModeView, slideKeyAction, slideTextScale } from './present-mode-view'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
}))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'scrivon-dark', isLight: false }),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    previewCodeTheme: () => 'github-dark',
    highlightFencedCodeNow: () => null,
    highlightFencedCode: () => new Promise<string>(() => {}),
}))

const TAB_ID = 'C:\\ws\\talk.md'

const state = vi.hoisted(() => ({
    tabs: [] as DocumentTab[],
    remoteImageTabs: new Set<string>(),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs: state.tabs }),
    useWorkspaceSession: () => ({ workspaceRoot: 'C:\\ws' }),
}))

vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({
    useMarkdownPreviewMemory: () => ({ scrollTopByTab: new Map(), remoteImageTabs: state.remoteImageTabs, allowRemoteImages: () => {} }),
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { appearance: { previewFontSize: 14 } } }),
}))

const openExternalLink = vi.hoisted(() => vi.fn())
vi.mock('@/components/studio/markdown/open-external-link', () => ({ openExternalLink }))

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/notify')>()), notifyError }))

/** A slide that says CRASH can't be drawn, as a document the parser can't take. */
vi.mock('@/components/studio/markdown/markdown-preview', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/studio/markdown/markdown-preview')>()
    const Preview = actual.MarkdownPreview
    return {
        ...actual,
        MarkdownPreview: function CrashingPreview(props: Parameters<typeof Preview>[0]) {
            if (props.source.includes('CRASH')) throw new Error('Slide went wrong')
            return <Preview {...props} />
        },
    }
})

function tab(content: string, id = TAB_ID): DocumentTab {
    return { id, path: id, name: 'talk.md', content, isDirty: false, isSaving: false }
}

function fakeFullscreen() {
    return { enter: vi.fn(async () => {}), leave: vi.fn(async () => {}) } satisfies PresentFullscreen
}

function Starter() {
    const { present, presentingTabId } = usePresentMode()
    return (
        <>
            <button type="button" onClick={() => present(TAB_ID)}>
                Start
            </button>
            <p data-testid="present-state">{presentingTabId ?? 'off'}</p>
        </>
    )
}

function Harness({ fullscreen, showView = true }: { fullscreen: PresentFullscreen; showView?: boolean }) {
    return (
        <PresentModeProvider fullscreen={fullscreen}>
            <Starter />
            {showView ? <PresentModeView /> : null}
        </PresentModeProvider>
    )
}

const THREE_SLIDES = '# One\n\n---\n\n# Two\n\n---\n\n# Three'

async function startPresenting(content = THREE_SLIDES) {
    state.tabs = [tab(content)]
    const fullscreen = fakeFullscreen()
    const user = userEvent.setup()
    const view = render(<Harness fullscreen={fullscreen} />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByRole('dialog')
    return { ...view, user, fullscreen }
}

const counter = () => document.querySelector('[data-slot="slide-counter"]')?.textContent
const shownSlide = () => document.querySelector<HTMLElement>('section[data-slide]:not([hidden])')
const presentState = () => screen.getByTestId('present-state').textContent

describe('PresentModeView', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.tabs = []
        state.remoteImageTabs = new Set()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('goes full screen and shows the first slide with its counter', async () => {
        const { fullscreen } = await startPresenting()

        expect(fullscreen.enter).toHaveBeenCalledTimes(1)
        expect(screen.getByRole('dialog', { name: 'Presenting talk.md' })).toBeInTheDocument()
        expect(shownSlide()).toHaveTextContent('One')
        expect(shownSlide()).toHaveAttribute('aria-label', 'Slide 1 of 3')
        expect(counter()).toBe('1 / 3')
    })

    it('moves through the slides with the keys, and stops at the first and last', async () => {
        const { user } = await startPresenting()

        await user.keyboard('{ArrowRight}')
        expect(counter()).toBe('2 / 3')
        await user.keyboard('{ArrowDown}')
        expect(counter()).toBe('3 / 3')
        await user.keyboard('{PageDown}')
        await user.keyboard(' ')
        expect(counter()).toBe('3 / 3')
        expect(shownSlide()).toHaveTextContent('Three')

        await user.keyboard('{ArrowLeft}')
        expect(counter()).toBe('2 / 3')
        await user.keyboard('{ArrowUp}')
        expect(counter()).toBe('1 / 3')
        await user.keyboard('{PageUp}')
        expect(counter()).toBe('1 / 3')

        await user.keyboard('{End}')
        expect(counter()).toBe('3 / 3')
        await user.keyboard('{Home}')
        expect(counter()).toBe('1 / 3')
        await user.keyboard(' ')
        expect(counter()).toBe('2 / 3')
    })

    it('announces the new slide politely', async () => {
        const { user } = await startPresenting()

        await user.keyboard('{ArrowRight}')

        const live = document.querySelector('[aria-live="polite"]')
        expect(live).toHaveTextContent('Slide 2 of 3')
    })

    it('moves with the Previous and Next buttons, which do nothing past the ends', async () => {
        const { user } = await startPresenting()
        const previous = screen.getByRole('button', { name: 'Previous slide' })
        const next = screen.getByRole('button', { name: 'Next slide' })

        expect(previous).toHaveAttribute('aria-disabled', 'true')
        await user.click(previous)
        expect(counter()).toBe('1 / 3')

        await user.click(next)
        await user.click(next)
        expect(counter()).toBe('3 / 3')
        expect(next).toHaveAttribute('aria-disabled', 'true')
        await user.click(next)
        expect(counter()).toBe('3 / 3')
    })

    it('starts each slide at its top', async () => {
        const { user } = await startPresenting()
        const viewport = document.querySelector<HTMLElement>('[data-slot="present-viewport"]')!
        viewport.scrollTop = 300

        await user.keyboard('{ArrowRight}')

        expect(viewport.scrollTop).toBe(0)
    })

    it('leaves present mode and full screen with Esc, and puts focus back', async () => {
        const { user, fullscreen } = await startPresenting()

        await user.keyboard('{Escape}')

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(presentState()).toBe('off')
        expect(fullscreen.leave).toHaveBeenCalled()
        await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toHaveFocus())
    })

    it('leaves with Esc while a code block’s Copy button has focus', async () => {
        const { user, fullscreen } = await startPresenting('```js\nconst a = 1\n```')

        screen.getByRole('button', { name: 'Copy code' }).focus()
        await user.keyboard('{Escape}')

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(fullscreen.leave).toHaveBeenCalled()
    })

    it('presses a focused button with Space rather than moving on', async () => {
        const { user } = await startPresenting()

        screen.getByRole('button', { name: 'Close present mode' }).focus()
        await user.keyboard(' ')

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('leaves present mode and full screen with the Close button', async () => {
        const { user, fullscreen } = await startPresenting()

        await user.click(screen.getByRole('button', { name: 'Close present mode' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(presentState()).toBe('off')
        expect(fullscreen.leave).toHaveBeenCalled()
    })

    it('follows the tab’s text, staying on the same slide number', async () => {
        const { user, rerender, fullscreen } = await startPresenting()
        await user.keyboard('{ArrowRight}')

        state.tabs = [tab('# Uno\n\n---\n\n# Dos\n\n---\n\n# Tres')]
        rerender(<Harness fullscreen={fullscreen} />)

        await waitFor(() => expect(shownSlide()).toHaveTextContent('Dos'))
        expect(counter()).toBe('2 / 3')
    })

    it('moves back to the last slide when the text now has fewer', async () => {
        const { user, rerender, fullscreen } = await startPresenting()
        await user.keyboard('{End}')

        state.tabs = [tab('# One\n\n---\n\n# Two')]
        rerender(<Harness fullscreen={fullscreen} />)

        await waitFor(() => expect(counter()).toBe('2 / 2'))
        expect(shownSlide()).toHaveTextContent('Two')
    })

    it('says so when the text has nothing left to show', async () => {
        const { rerender, fullscreen } = await startPresenting()

        state.tabs = [tab('')]
        rerender(<Harness fullscreen={fullscreen} />)

        await waitFor(() => expect(counter()).toBe('0 / 0'))
        expect(screen.getByText('Nothing to present. Add some text to the document.')).toBeInTheDocument()
    })

    it('closes when the tab closes', async () => {
        const { rerender, fullscreen } = await startPresenting()

        state.tabs = []
        rerender(<Harness fullscreen={fullscreen} />)

        await waitFor(() => expect(presentState()).toBe('off'))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(fullscreen.leave).toHaveBeenCalled()
    })

    it('closes with a notice when a slide can’t be drawn', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const { rerender, fullscreen } = await startPresenting()

        state.tabs = [tab('# One\n\nCRASH')]
        rerender(<Harness fullscreen={fullscreen} />)

        // A crash takes React a second render and the boundary to catch, which can be slow on a busy machine.
        await waitFor(() => expect(presentState()).toBe('off'), { timeout: 5000 })
        expect(fullscreen.leave).toHaveBeenCalled()
        expect(notifyError).toHaveBeenCalledWith(
            "Couldn't present the document",
            expect.objectContaining({ message: 'Slide went wrong' }),
            expect.anything()
        )
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 5000 })
    })

    it('ends present mode and leaves full screen when the view goes', async () => {
        const { rerender, fullscreen } = await startPresenting()

        rerender(<Harness fullscreen={fullscreen} showView={false} />)

        await waitFor(() => expect(presentState()).toBe('off'))
        expect(fullscreen.leave).toHaveBeenCalled()
    })

    it('opens web links in the browser, and does nothing for footnote and heading links', async () => {
        const { user } = await startPresenting('# Top\n\nSee [the site](https://example.com), [the top](#top) and a note[^1].\n\n[^1]: The note.')

        await user.click(screen.getByRole('link', { name: 'the top' }))
        await user.click(screen.getByRole('link', { name: '1' }))
        expect(openExternalLink).not.toHaveBeenCalled()

        await user.click(screen.getByRole('link', { name: 'the site' }))
        expect(openExternalLink).toHaveBeenCalledWith('https://example.com')
        expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('blocks web images unless "Load images" was chosen for the tab', async () => {
        const { rerender, fullscreen } = await startPresenting('![Logo](https://example.com/logo.png)')
        expect(screen.getByRole('img', { name: 'Blocked web image: Logo' })).toBeInTheDocument()

        state.remoteImageTabs = new Set([TAB_ID])
        rerender(<Harness fullscreen={fullscreen} />)

        await waitFor(() => expect(document.querySelector('img[src="https://example.com/logo.png"]')).not.toBeNull())
    })

    it('draws over the whole window, the title bar too, which only stays above other dialogs', async () => {
        await startPresenting()

        expect(screen.getByRole('dialog')).toHaveClass('fixed', 'inset-0', 'z-50')
        expect(document.querySelector('[data-slot$="dialog-popup"]')).toBeNull()
    })

    it('marks itself as an open modal, so the app’s shortcuts stay off behind it', async () => {
        await startPresenting()

        const dialog = screen.getByRole('dialog')
        // The selector useGlobalKeybinds looks for (OPEN_MODAL_SELECTOR).
        expect(dialog.matches('[role="dialog"][data-open]:not([aria-modal="false"])')).toBe(true)
    })

    it('leaves keys pressed with Ctrl to the app (zoom)', async () => {
        await startPresenting()

        fireEvent.keyDown(document.querySelector('[data-slot="present-viewport"]')!, { key: 'ArrowRight', ctrlKey: true })

        expect(counter()).toBe('1 / 3')
    })

    it('ignores keys while an input method is composing', async () => {
        await startPresenting()

        act(() => {
            fireEvent.keyDown(document.querySelector('[data-slot="present-viewport"]')!, { key: 'ArrowRight', isComposing: true })
        })

        expect(counter()).toBe('1 / 3')
    })
})

describe('slideKeyAction', () => {
    const key = (k: string, extra: Partial<Parameters<typeof slideKeyAction>[0]> = {}) =>
        slideKeyAction({ key: k, ctrlKey: false, altKey: false, metaKey: false, target: null, ...extra })

    it('maps the keys to moves', () => {
        expect(['ArrowRight', 'ArrowDown', 'PageDown', ' '].map((k) => key(k))).toEqual(['next', 'next', 'next', 'next'])
        expect(['ArrowLeft', 'ArrowUp', 'PageUp'].map((k) => key(k))).toEqual(['previous', 'previous', 'previous'])
        expect(key('Home')).toBe('first')
        expect(key('End')).toBe('last')
        expect(key('Escape')).toBe('exit')
        expect(key('a')).toBeNull()
    })

    it('always leaves with Esc, but leaves other keys with modifiers alone', () => {
        expect(key('Escape', { ctrlKey: true })).toBe('exit')
        expect(key('ArrowRight', { altKey: true })).toBeNull()
        expect(key('End', { metaKey: true })).toBeNull()
    })

    it('leaves Space to a focused button or link', () => {
        const button = document.createElement('button')
        const link = document.createElement('a')
        link.href = 'https://example.com'
        expect(key(' ', { target: button })).toBeNull()
        expect(key(' ', { target: link })).toBeNull()
        expect(key('ArrowRight', { target: button })).toBe('next')
    })
})

describe('slideTextScale', () => {
    it('makes the text larger than the preview’s, more on a bigger screen, within limits', () => {
        expect(slideTextScale(0, 0, 14)).toBe(1.25)
        expect(slideTextScale(1600, 1000, 14)).toBe(2)
        expect(slideTextScale(4000, 3000, 14)).toBe(2.25)
    })

    it('follows the Preview text size setting', () => {
        expect(slideTextScale(1600, 1000, 21)).toBe(3)
    })
})
