import { render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FencedCodeBlock } from './fenced-code-block'

const theme = vi.hoisted(() => ({ themeId: 'scrivon-dark', isLight: false }))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: theme.themeId, isLight: theme.isLight }),
}))

const shiki = vi.hoisted(() => ({
    /** Themes highlightFencedCodeNow can draw in; any other has to wait for highlightFencedCode. */
    readyThemes: new Set<string>(),
    pending: [] as { theme: string; resolve: () => void }[],
}))

function shikiHtml(code: string, theme: string): string {
    return `<pre class="shiki" data-theme="${theme}"><code>${code}</code></pre>`
}

vi.mock('@/lib/markdown/shiki-highlighter', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/markdown/shiki-highlighter')>()),
    highlightFencedCodeNow: (code: string, _language: string | undefined, theme: string) =>
        shiki.readyThemes.has(theme) ? shikiHtml(code, theme) : null,
    highlightFencedCode: (code: string, _language: string | undefined, theme: string) =>
        new Promise<string>((resolve) => shiki.pending.push({ theme, resolve: () => resolve(shikiHtml(code, theme)) })),
}))

/** What the block shows: its text, whether it's coloured, and in which theme. */
function shown(container: HTMLElement) {
    const block = container.firstElementChild as HTMLElement
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

    it('shows new code as plain text when it can’t be coloured yet, rather than the old code', () => {
        const code = `var c${uniqueCode} = 3`
        const { container, rerender } = render(<FencedCodeBlock code={code} language="ts" />)

        shiki.readyThemes.clear()
        rerender(<FencedCodeBlock code={`${code}4`} language="ts" />)
        expect(shown(container)).toEqual({ text: `${code}4`, mode: 'plain', theme: undefined })
    })
})
