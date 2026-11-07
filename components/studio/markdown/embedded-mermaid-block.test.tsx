import { render, screen } from '@testing-library/react'
import { useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmbeddedMermaidBlock } from './embedded-mermaid-block'

type HookResult = {
    svgForDisplay: string | null
    dimensions: { width: number; height: number } | null
    error: string | null
    currentError: string | null
    isStale: boolean
    isPending: boolean
    isEmpty: boolean
}

const hook = vi.hoisted(() => ({ result: null as unknown as HookResult }))

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => hook.result,
}))

type ProbeProps = { svg: string; label?: string; description?: string }

/** What the stand-in iframe saw: the scale it was drawn at, and the name it was given. */
const seen = vi.hoisted(() => ({ scales: [] as string[], labels: [] as (string | undefined)[], descriptions: [] as (string | undefined)[] }))

vi.mock('@/lib/mermaid/svg-iframe', () => ({
    DiagramIframe: function DiagramIframeProbe({ label, description }: ProbeProps) {
        const ref = useRef<HTMLDivElement>(null)
        useLayoutEffect(() => {
            // Runs before the parent's layout effects, so it sees what the first frame would draw.
            seen.scales.push(ref.current?.parentElement?.style.transform ?? '')
            seen.labels.push(label)
            seen.descriptions.push(description)
        })
        return <div ref={ref} data-testid="diagram" />
    },
}))

function picture(svg: string): HookResult {
    return {
        svgForDisplay: svg,
        dimensions: { width: 1000, height: 400 },
        error: null,
        currentError: null,
        isStale: false,
        isPending: false,
        isEmpty: false,
    }
}

function block(source = 'flowchart LR\n  A --> B', ordinal = 0) {
    return <EmbeddedMermaidBlock source={source} blockId={`block-${ordinal}`} ordinal={ordinal} tabId="doc.md" onExpand={() => {}} />
}

let width = 532

describe('EmbeddedMermaidBlock', () => {
    beforeEach(() => {
        seen.scales = []
        seen.labels = []
        seen.descriptions = []
        width = 532
        hook.result = picture('<svg data-test="scaled"></svg>')
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('draws a cached diagram scaled to fit from its first frame, never at full size', () => {
        render(block())

        // 532px wide, minus 32px of padding, leaves 500px for a 1000px-wide diagram.
        expect(seen.scales.length).toBeGreaterThan(0)
        expect(new Set(seen.scales)).toEqual(new Set(['scale(0.5)']))
    })

    it('holds the placeholder instead of drawing while the preview has no width', () => {
        width = 0
        const { container } = render(block())

        expect(seen.scales).toEqual([])
        expect(container.querySelector('.min-h-\\[120px\\]')).not.toBeNull()
    })

    it('dims the last picture that worked and says why the current text does not draw (U02)', () => {
        hook.result = { ...picture('<svg data-test="old"></svg>'), currentError: 'Parse error on line 2', isStale: true }
        render(block('flowchart LR\n  A -->'))

        expect(screen.getByTestId('diagram').parentElement).toHaveClass('opacity-40')
        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('Diagram has an error')
        expect(status).toHaveTextContent('Parse error on line 2')
        expect(status).toHaveTextContent('Showing the last version that worked.')
    })

    it('shows the picture at full strength once the text draws again', () => {
        render(block())

        expect(screen.getByTestId('diagram').parentElement).not.toHaveClass('opacity-40')
        expect(screen.queryByRole('status')).toBeNull()
    })

    it('shows the error card when there is no picture to fall back to', () => {
        hook.result = { ...picture(''), svgForDisplay: null, dimensions: null, error: 'Parse error', currentError: 'Parse error' }
        render(block('flowchart LR\n  A -->'))

        expect(screen.queryByTestId('diagram')).toBeNull()
        expect(screen.getByRole('status')).toHaveTextContent('Parse error')
    })

    it('says there is nothing to draw yet, at the placeholder height, for a header-only block (U39)', () => {
        hook.result = { ...picture(''), svgForDisplay: null, dimensions: null, isEmpty: true }
        const { container } = render(block('graph TD'))

        expect(screen.getByText('Nothing to draw yet. Add some nodes to see the diagram.')).toBeInTheDocument()
        expect(container.querySelector('.min-h-\\[120px\\]')).not.toBeNull()
    })

    it('names the diagram after its accTitle, and describes it with its accDescr block (A27)', () => {
        render(block('flowchart LR\n  accTitle: Login flow\n  accDescr {\n    How a user\n    signs in\n  }\n  A --> B', 1))

        expect(seen.labels.at(-1)).toBe('Login flow')
        expect(seen.descriptions.at(-1)).toBe('How a user signs in')
        expect(screen.getByRole('button', { name: 'Expand diagram 2: Login flow' })).toBeInTheDocument()
    })

    it('numbers a diagram with no accTitle', () => {
        render(block('flowchart LR\n  A --> B', 2))

        expect(seen.labels.at(-1)).toBe('Diagram 3')
        expect(seen.descriptions.at(-1)).toBeUndefined()
    })
})
