import { render } from '@testing-library/react'
import { act, useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SvgContentBounds } from '@/lib/mermaid/svg-bounds'
import { EmbeddedMermaidBlock } from './embedded-mermaid-block'

const diagram = vi.hoisted(() => ({ svg: '', width: 1000, height: 400 }))

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({
        svgForDisplay: diagram.svg,
        dimensions: { width: diagram.width, height: diagram.height },
        error: null,
        isPending: false,
    }),
}))

type ProbeProps = { svg: string; bounds: SvgContentBounds | null; onBoundsMeasured?: (bounds: SvgContentBounds, svg: string) => void }

/** What the stand-in iframe saw: the scale it was drawn at, and the bounds it was given when it first mounted. */
const seen = vi.hoisted(() => ({
    scales: [] as string[],
    firstBounds: [] as (SvgContentBounds | null)[],
    measure: null as ProbeProps['onBoundsMeasured'] | null,
}))

vi.mock('@/lib/mermaid/svg-iframe', () => ({
    DiagramIframe: function DiagramIframeProbe({ bounds, onBoundsMeasured }: ProbeProps) {
        const ref = useRef<HTMLDivElement>(null)
        const mounted = useRef(false)
        useLayoutEffect(() => {
            // Runs before the parent's layout effects, so it sees what the first frame would draw.
            seen.scales.push(ref.current?.parentElement?.style.transform ?? '')
            if (!mounted.current) seen.firstBounds.push(bounds)
            mounted.current = true
            seen.measure = onBoundsMeasured ?? null
        })
        return <div ref={ref} />
    },
}))

function block(ordinal = 0) {
    return (
        <EmbeddedMermaidBlock
            source="flowchart LR\n  A --> B"
            blockId={`doc.md:${ordinal}:mermaid`}
            ordinal={ordinal}
            tabId="doc.md"
            onExpand={() => {}}
        />
    )
}

let width = 532

describe('EmbeddedMermaidBlock', () => {
    beforeEach(() => {
        seen.scales = []
        seen.firstBounds = []
        seen.measure = null
        width = 532
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('draws a cached diagram scaled to fit from its first frame, never at full size', () => {
        diagram.svg = '<svg data-test="scaled"></svg>'
        render(block())

        // 532px wide, minus 32px of padding, leaves 500px for a 1000px-wide diagram.
        expect(seen.scales.length).toBeGreaterThan(0)
        expect(new Set(seen.scales)).toEqual(new Set(['scale(0.5)']))
    })

    it('holds the placeholder instead of drawing while the preview has no width', () => {
        diagram.svg = '<svg data-test="hidden"></svg>'
        width = 0
        const { container } = render(block())

        expect(seen.scales).toEqual([])
        expect(container.querySelector('.min-h-\\[120px\\]')).not.toBeNull()
    })

    it('lays out a diagram that mounts again at its measured size straight away', () => {
        diagram.svg = '<svg data-test="remount"></svg>'
        const measured: SvgContentBounds = { width: 920, height: 320, offsetX: 40, offsetY: 40 }

        const first = render(block())
        expect(seen.firstBounds).toEqual([null])
        act(() => seen.measure?.(measured, diagram.svg))
        first.unmount()

        render(block())
        expect(seen.firstBounds).toEqual([null, measured])
    })

    it('still knows a diagram’s size after another diagram was edited for a long time', () => {
        diagram.svg = '<svg data-test="kept"></svg>'
        const measured: SvgContentBounds = { width: 900, height: 300, offsetX: 50, offsetY: 50 }
        const first = render(block(0))
        act(() => seen.measure?.(measured, diagram.svg))
        first.unmount()

        // Every keystroke in the other diagram draws, and measures, a new SVG.
        const editing = render(block(1))
        for (let key = 0; key < 150; key++) {
            diagram.svg = `<svg data-test="edit-${key}"></svg>`
            editing.rerender(block(1))
            act(() => seen.measure?.({ width: 800 + key, height: 200, offsetX: 0, offsetY: 0 }, diagram.svg))
        }
        editing.unmount()

        diagram.svg = '<svg data-test="kept"></svg>'
        seen.firstBounds = []
        render(block(0))
        expect(seen.firstBounds).toEqual([measured])
    })
})
