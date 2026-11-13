import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { overlayButtonClassName } from '@/lib/ui/button-classes'
import { createHighlightCache, FencedCodeBlock } from './fenced-code-block'

const theme = vi.hoisted(() => ({ themeId: 'scrivon-dark', isLight: false }))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: theme.themeId, isLight: theme.isLight }),
}))

const shiki = vi.hoisted(() => ({
    /** Themes highlightFencedCodeNow can draw in; any other has to wait for highlightFencedCode. */
    readyThemes: new Set<string>(),
    pending: [] as { code: string; theme: string; resolve: () => void }[],
}))

function shikiHtml(code: string, theme: string): string {
    return `<pre class="shiki" data-theme="${theme}"><code>${code}</code></pre>`
}

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notifyError }))

vi.mock('@/lib/markdown/shiki-highlighter', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/markdown/shiki-highlighter')>()),
    highlightFencedCodeNow: (code: string, _language: string | undefined, theme: string) =>
        shiki.readyThemes.has(theme) ? shikiHtml(code, theme) : null,
    highlightFencedCode: (code: string, _language: string | undefined, theme: string) =>
        new Promise<string>((resolve) => shiki.pending.push({ code, theme, resolve: () => resolve(shikiHtml(code, theme)) })),
}))

/** What the block shows: its text, whether it's coloured, and in which theme. */
function shown(container: HTMLElement) {
    const block = container.querySelector<HTMLElement>('[data-mode]')!
    return { text: block.textContent, mode: block.dataset.mode, theme: block.querySelector('pre')?.dataset.theme }
}

let uniqueCode = 0

describe('FencedCodeBlock', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        theme.themeId = 'scrivon-dark'
        theme.isLight = false
        shiki.readyThemes = new Set(['github-dark', 'github-light'])
        shiki.pending = []
        uniqueCode++
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('keeps its colours while the code is being typed', () => {
        const code = `const a${uniqueCode} = 1`
        const { container, rerender } = render(<FencedCodeBlock code={code} language="ts" />)
        expect(shown(container)).toEqual({ text: code, mode: 'highlight', theme: 'github-dark' })

        rerender(<FencedCodeBlock code={`${code}2`} language="ts" />)
        expect(shown(container)).toEqual({ text: `${code}2`, mode: 'highlight', theme: 'github-dark' })
    })

    it('keeps the old colours, not plain text, while the new theme’s colours are on the way', async () => {
        const code = `let b${uniqueCode} = 2`
        const { container, rerender } = render(<FencedCodeBlock code={code} language="ts" />)
        expect(shown(container).theme).toBe('github-dark')

        shiki.readyThemes.delete('github-light')
        theme.themeId = 'scrivon-light'
        theme.isLight = true
        rerender(<FencedCodeBlock code={code} language="ts" />)
        expect(shown(container)).toEqual({ text: code, mode: 'highlight', theme: 'github-dark' })

        // Only the theme changed, so the new colours are fetched at once rather than after a pause in typing.
        await act(async () => {
            vi.advanceTimersByTime(0)
            shiki.pending.at(-1)?.resolve()
        })
        expect(shown(container)).toEqual({ text: code, mode: 'highlight', theme: 'github-light' })
    })

    it('uses the palette’s own code colours', async () => {
        theme.themeId = 'dracula'
        const code = `const d${uniqueCode} = 4`
        const { container } = render(<FencedCodeBlock code={code} language="ts" />)

        // Dracula's code theme is loaded the first time a block needs it.
        expect(shown(container).mode).toBe('plain')
        await act(async () => {
            vi.advanceTimersByTime(400)
            shiki.pending.at(-1)?.resolve()
        })
        expect(shown(container)).toEqual({ text: code, mode: 'highlight', theme: 'dracula' })
    })

    it('keeps other blocks’ colours remembered while one block is typed in', () => {
        const other = `const kept${uniqueCode} = 1`
        const first = render(<FencedCodeBlock code={other} language="ts" />)
        act(() => vi.advanceTimersByTime(400))
        first.unmount()

        const typed = `let typed${uniqueCode} = `
        const typing = render(<FencedCodeBlock code={typed} language="ts" />)
        for (let key = 0; key < 250; key++) typing.rerender(<FencedCodeBlock code={`${typed}${key}`} language="ts" />)
        typing.unmount()

        // Back to the first block at a moment its colours can't be made on the spot.
        shiki.readyThemes.clear()
        const { container } = render(<FencedCodeBlock code={other} language="ts" />)
        expect(shown(container)).toEqual({ text: other, mode: 'highlight', theme: 'github-dark' })
    })

    it('shows new code as plain text when it can’t be coloured yet, rather than the old code', () => {
        const code = `var c${uniqueCode} = 3`
        const { container, rerender } = render(<FencedCodeBlock code={code} language="ts" />)

        shiki.readyThemes.clear()
        rerender(<FencedCodeBlock code={`${code}4`} language="ts" />)
        expect(shown(container)).toEqual({ text: `${code}4`, mode: 'plain', theme: undefined })
    })

    describe('remembers only the latest version of a block being edited (N71)', () => {
        /** Whether a block with this code would show in colour straight from the cache. */
        function isRemembered(code: string): boolean {
            const ready = shiki.readyThemes
            shiki.readyThemes = new Set()
            const { container, unmount } = render(<FencedCodeBlock code={code} language="ts" />)
            const mode = shown(container).mode
            unmount()
            shiki.readyThemes = ready
            return mode === 'highlight'
        }

        it('when its colours are made on the spot', () => {
            const versions = [0, 1, 2].map((n) => `const e${uniqueCode} = ${n}`)
            const { rerender, unmount } = render(<FencedCodeBlock code={versions[0]!} language="ts" />)
            act(() => vi.advanceTimersByTime(400))
            for (const code of versions.slice(1)) {
                rerender(<FencedCodeBlock code={code} language="ts" />)
                act(() => vi.advanceTimersByTime(400))
            }
            unmount()

            expect(versions.map(isRemembered)).toEqual([false, false, true])
        })

        it('when its colours come after a pause, as for a big block', async () => {
            shiki.readyThemes.clear()
            const versions = [0, 1].map((n) => `const f${uniqueCode} = ${n}`)
            const { rerender, unmount } = render(<FencedCodeBlock code={versions[0]!} language="ts" />)
            for (const [index, code] of versions.entries()) {
                if (index > 0) rerender(<FencedCodeBlock code={code} language="ts" />)
                await act(async () => {
                    vi.advanceTimersByTime(400)
                    shiki.pending.at(-1)?.resolve()
                })
            }
            unmount()

            expect(versions.map(isRemembered)).toEqual([false, true])
        })

        it('but keeps the colours of a block that goes, for when its tab is shown again', () => {
            const code = `const g${uniqueCode} = 1`
            const first = render(<FencedCodeBlock code={code} language="ts" />)
            act(() => vi.advanceTimersByTime(400))
            first.unmount()
            expect(isRemembered(code)).toBe(true)

            // Shown again and then edited: the version it no longer shows goes.
            const again = render(<FencedCodeBlock code={code} language="ts" />)
            again.rerender(<FencedCodeBlock code={`${code}0`} language="ts" />)
            act(() => vi.advanceTimersByTime(400))
            again.unmount()
            expect([code, `${code}0`].map(isRemembered)).toEqual([false, true])
        })

        describe('but never one another block still shows (review)', () => {
            /** Code blocks matched to the components by position, as the preview keys them. */
            function Blocks({ codes }: { codes: string[] }) {
                return codes.map((code, index) => <FencedCodeBlock key={index} code={code} language="ts" />)
            }

            /** Renders the blocks and waits for their colours to be saved. */
            function renderRemembered(codes: string[]) {
                const view = render(<Blocks codes={codes} />)
                act(() => vi.advanceTimersByTime(400))
                return view
            }

            it('when the first block is deleted and each one after it takes its neighbour’s code', () => {
                const [w, x, y] = ['w', 'x', 'y'].map((name) => `const ${name}${uniqueCode} = 1`)
                const { rerender, unmount } = renderRemembered([w!, x!, y!])

                rerender(<Blocks codes={[x!, y!]} />)
                act(() => vi.advanceTimersByTime(400))
                unmount()
                expect([x!, y!].map(isRemembered)).toEqual([true, true])
            })

            it('when a block is added above the others, without highlighting them again', async () => {
                const [a, b, c, added] = ['a', 'b', 'c', 'added'].map((name) => `const ${name}${uniqueCode} = 1`)
                const { rerender, unmount } = renderRemembered([a!, b!, c!])

                // As for big blocks, whose colours can't be made on the spot.
                shiki.readyThemes.clear()
                rerender(<Blocks codes={[added!, a!, b!, c!]} />)
                await act(async () => {
                    vi.advanceTimersByTime(400)
                    for (const call of shiki.pending) call.resolve()
                })
                expect(shiki.pending.map((call) => call.code)).toEqual([added])

                unmount()
                expect([a!, b!, c!, added!].map(isRemembered)).toEqual([true, true, true, true])
            })

            it('when one of two copies of the same snippet is edited', () => {
                const snippet = `npm install ${uniqueCode}`
                const { rerender, unmount } = renderRemembered([snippet, snippet])

                rerender(<Blocks codes={[`${snippet} --save`, snippet]} />)
                act(() => vi.advanceTimersByTime(400))
                unmount()
                expect([snippet, `${snippet} --save`].map(isRemembered)).toEqual([true, true])
            })
        })

        it('and keeps the colours of the theme it was shown in before, for switching back', () => {
            const code = `const h${uniqueCode} = 1`
            const { rerender, unmount } = render(<FencedCodeBlock code={code} language="ts" />)
            act(() => vi.advanceTimersByTime(400))

            theme.themeId = 'scrivon-light'
            theme.isLight = true
            rerender(<FencedCodeBlock code={code} language="ts" />)
            act(() => vi.advanceTimersByTime(400))
            unmount()

            theme.themeId = 'scrivon-dark'
            theme.isLight = false
            expect(isRemembered(code)).toBe(true)
        })
    })
})

describe('createHighlightCache (N71)', () => {
    it('drops the oldest entries once there are too many', () => {
        const cache = createHighlightCache(2, 1_000)
        cache.set('a', '1')
        cache.set('b', '2')
        cache.set('c', '3')
        expect([cache.has('a'), cache.get('b'), cache.get('c')]).toEqual([false, '2', '3'])
    })

    it('drops the oldest entries once keys and HTML together are too big', () => {
        const cache = createHighlightCache(200, 10)
        cache.set('a', '1234')
        cache.set('b', '1234')
        expect([cache.has('a'), cache.has('b')]).toEqual([true, true])
        cache.set('c', '12')
        expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([false, true, true])
    })

    it('counts an entry saved again only once, and frees what a removed entry took', () => {
        const cache = createHighlightCache(200, 10)
        for (let n = 0; n < 5; n++) cache.set('a', '1234')
        cache.set('b', '1234')
        expect([cache.has('a'), cache.has('b')]).toEqual([true, true])

        cache.delete('a')
        cache.set('c', '1234')
        expect([cache.has('b'), cache.has('c')]).toEqual([true, true])
    })

    it('doesn’t keep an entry too big on its own, nor drop the others for it', () => {
        const cache = createHighlightCache(200, 10)
        cache.set('a', '1')
        cache.set('big', '123456789')
        expect([cache.has('a'), cache.has('big')]).toEqual([true, false])
    })
})

describe('FencedCodeBlock: Copy button', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

    function setClipboard(writeText: (text: string) => Promise<void>) {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    }

    beforeEach(() => {
        shiki.readyThemes = new Set(['github-dark'])
        notifyError.mockClear()
    })

    afterEach(() => {
        vi.useRealTimers()
        if (original) Object.defineProperty(navigator, 'clipboard', original)
        else Reflect.deleteProperty(navigator, 'clipboard')
    })

    it('shows the language and copies the code, then says so for a moment', async () => {
        vi.useFakeTimers()
        const writeText = vi.fn(async () => {})
        setClipboard(writeText)
        render(<FencedCodeBlock code={'const a = 1\nconst b = 2'} language="ts" />)
        expect(screen.getByText('ts')).toBeInTheDocument()

        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy code' })))
        expect(writeText).toHaveBeenCalledWith('const a = 1\nconst b = 2')
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

        act(() => vi.advanceTimersByTime(2000))
        expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    })

    it('can be reached and used with the keyboard', async () => {
        const user = userEvent.setup()
        // After setup, which puts in a clipboard of its own.
        const writeText = vi.fn(async () => {})
        setClipboard(writeText)
        render(<FencedCodeBlock code="echo hi" language="sh" />)

        await user.tab()
        expect(screen.getByRole('button', { name: 'Copy code' })).toHaveFocus()
        await user.keyboard('{Enter}')
        expect(writeText).toHaveBeenCalledWith('echo hi')
    })

    it("says when the code couldn't be copied", async () => {
        setClipboard(async () => Promise.reject(new Error('Not allowed')))
        render(<FencedCodeBlock code="echo hi" />)

        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy code' })))
        expect(notifyError).toHaveBeenCalledWith("Couldn't copy the code", expect.any(Error))
        expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    })

    it('shows no label for a block without a language', () => {
        const { container } = render(<FencedCodeBlock code="plain" />)
        expect(container.querySelector('[data-code-language]')).toBeNull()
    })

    it('uses the same overlay button as diagrams, tagged as English', () => {
        render(<FencedCodeBlock code="plain" />)
        const button = screen.getByRole('button', { name: 'Copy code' })
        expect(button).toHaveAttribute('data-slot', 'button')
        expect(button).toHaveClass(...overlayButtonClassName.split(' '))
        expect(button).toHaveTextContent('Copy')
        expect(button.closest('[lang]')).toHaveAttribute('lang', 'en')
    })
})
