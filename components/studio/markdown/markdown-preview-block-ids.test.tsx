import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSvgCache } from '@/lib/mermaid/svg-cache'
import { MarkdownPreview } from './markdown-preview'

// The real render hook, cache and renderer, so this shows what each block actually draws (B28).

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'scrivon-light', isLight: true }),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    previewCodeTheme: () => 'github-light',
    highlightFencedCodeNow: () => null,
    highlightFencedCode: () => new Promise<string>(() => {}),
}))

/** Every picture a diagram frame was asked to draw, newest last. */
const drawn = vi.hoisted(() => ({ svgs: [] as string[] }))

vi.mock('@/lib/mermaid/svg-iframe', () => ({
    DiagramIframe: function DiagramIframeProbe({ svg }: { svg: string }) {
        drawn.svgs.push(svg)
        return <div data-testid="diagram" data-svg={svg} />
    },
}))

const ALPHA = 'graph TD\n  A1[Alpha] --> B1[Beta]'
const GAMMA = 'graph TD\n  C2[Gamma] --> D2[Delta]'
const GAMMA_EDITED = 'graph TD\n  C2[Gamma] --> D2[Delta] --> E2[Epsilon]'
/** Doesn't parse: no direction after `graph`. */
const GAMMA_BROKEN = 'graph\n  C2[Gamma] --> D2[Delta]'
const NEW = 'graph TD\n  N1[Newcomer] --> N2[Arrival]'

const noop = () => {}
const callbacks = { onExpandBlock: noop, onLinkClick: noop, loadRemoteImages: false, onRemoteImageBlocked: () => noop }

function doc(...diagrams: string[]): string {
    return diagrams.map((diagram, index) => `Paragraph ${index}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``).join('\n\n')
}

function preview(tabId: string, source: string) {
    return <MarkdownPreview source={source} tabId={tabId} {...callbacks} />
}

async function finishRendering() {
    await act(async () => {
        vi.advanceTimersByTime(250)
    })
}

function blocks(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-mermaid-block-id]'))
}

function shownSvg(block: HTMLElement): string | null {
    return block.querySelector<HTMLElement>('[data-testid="diagram"]')?.dataset.svg ?? null
}

describe('Markdown diagram blocks keep their own pictures when blocks move (B28)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        clearSvgCache()
        drawn.svgs = []
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 800)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('never shows the deleted block’s picture in the slot of the block that moved up', async () => {
        const { container, rerender } = render(preview('moved.md', doc(ALPHA, GAMMA)))
        await finishRendering()
        expect(blocks(container).map(shownSvg)).toEqual([expect.stringContaining('Alpha'), expect.stringContaining('Gamma')])

        drawn.svgs = []
        rerender(preview('moved.md', doc(GAMMA)))
        expect(shownSvg(blocks(container)[0]!)).toContain('Gamma')
        await finishRendering()

        expect(shownSvg(blocks(container)[0]!)).toContain('Gamma')
        expect(drawn.svgs.some((svg) => svg.includes('Alpha'))).toBe(false)
    })

    it('shows the moved block’s own error, not the deleted block’s picture, when it does not parse', async () => {
        const { container, rerender } = render(preview('broken.md', doc(ALPHA, GAMMA_BROKEN)))
        await finishRendering()
        expect(shownSvg(blocks(container)[0]!)).toContain('Alpha')
        expect(shownSvg(blocks(container)[1]!)).toBeNull()

        drawn.svgs = []
        rerender(preview('broken.md', doc(GAMMA_BROKEN)))
        await finishRendering()

        expect(blocks(container)).toHaveLength(1)
        expect(shownSvg(blocks(container)[0]!)).toBeNull()
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(drawn.svgs.some((svg) => svg.includes('Alpha'))).toBe(false)
    })

    it('shows a new diagram typed above another as rendering, not as its neighbour', async () => {
        const { container, rerender } = render(preview('typed.md', doc(ALPHA)))
        await finishRendering()

        drawn.svgs = []
        rerender(preview('typed.md', doc(NEW, ALPHA)))
        const [added, existing] = blocks(container)
        expect(shownSvg(added!)).toBeNull()
        expect(added).toHaveTextContent('Rendering diagram…')
        expect(shownSvg(existing!)).toContain('Alpha')

        await finishRendering()
        expect(blocks(container).map(shownSvg)).toEqual([expect.stringContaining('Newcomer'), expect.stringContaining('Alpha')])
        expect(shownSvg(blocks(container)[0]!)).not.toContain('Alpha')
    })

    it('keeps a block’s id while it is edited, so a typo falls back to its own last picture', async () => {
        const { container, rerender } = render(preview('edited.md', doc(ALPHA, GAMMA)))
        await finishRendering()
        const ids = blocks(container).map((block) => block.dataset.mermaidBlockId)

        rerender(preview('edited.md', doc(ALPHA, GAMMA_EDITED)))
        await finishRendering()
        expect(blocks(container).map((block) => block.dataset.mermaidBlockId)).toEqual(ids)
        expect(shownSvg(blocks(container)[1]!)).toContain('Epsilon')

        rerender(preview('edited.md', doc(ALPHA, GAMMA_BROKEN)))
        await finishRendering()
        expect(blocks(container).map((block) => block.dataset.mermaidBlockId)).toEqual(ids)
        expect(shownSvg(blocks(container)[1]!)).toContain('Epsilon')
        expect(screen.getByRole('status')).toHaveTextContent('Showing the last version that worked.')
    })
})
