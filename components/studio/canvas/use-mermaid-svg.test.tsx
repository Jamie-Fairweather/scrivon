import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { clearSvgCache } from '@/lib/mermaid/svg-cache'

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'scrivon-light' }),
}))

vi.mock('@/lib/mermaid/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/render')>()
    return { ...actual, renderMermaidDiagram: vi.fn(actual.renderMermaidDiagram) }
})

const V1 = 'graph TD\n  A --> B'
const V2 = 'graph TD\n  A --> B --> C'
const V3 = 'graph TD\n  A --> B --> C --> D'
const BROKEN = 'graph\n  A --> B'

function expectedSvg(source: string) {
    return vi.mocked(renderMermaidDiagram).getMockImplementation()!(source, 'scrivon-light')
}

function waitForRender() {
    act(() => {
        vi.advanceTimersByTime(250)
    })
}

beforeEach(() => {
    vi.useFakeTimers()
    clearSvgCache()
    vi.mocked(renderMermaidDiagram).mockClear()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('useMermaidSvg', () => {
    it('renders the source after a pause', () => {
        const { result } = renderHook(() => useMermaidSvg(V1, 'a.mmd'))
        expect(result.current.isPending).toBe(true)

        waitForRender()

        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        expect(result.current.error).toBeNull()
    })

    it('falls back to the latest render of a document after a remount, not the first one (B14)', () => {
        const first = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        waitForRender()
        first.rerender({ source: V2 })
        waitForRender()
        first.rerender({ source: V3 })
        waitForRender()
        first.unmount()

        const again = renderHook(() => useMermaidSvg(BROKEN, 'a.mmd'))

        expect(again.result.current.svgForDisplay).toBe(expectedSvg(V3))
    })

    it('reports a syntax error even when an earlier render is still on screen (U02)', () => {
        const { result, rerender } = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        waitForRender()

        rerender({ source: BROKEN })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), error: null, isStale: true, isPending: false })

        waitForRender()
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        expect(result.current.isStale).toBe(true)
        expect(result.current.error).toMatch(/\S/)

        rerender({ source: V2 })
        waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), error: null, isStale: false })
    })

    it('does not bring a deleted diagram back when typing starts again (U02)', () => {
        const { result, rerender } = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        waitForRender()

        rerender({ source: '   ' })
        expect(result.current.svgForDisplay).toBeNull()

        rerender({ source: 'f' })
        expect(result.current.svgForDisplay).toBeNull()
        waitForRender()
        expect(result.current.svgForDisplay).toBeNull()
        expect(result.current.error).toMatch(/\S/)
    })

    it('shows the error straight away for a document that never rendered', () => {
        const { result } = renderHook(() => useMermaidSvg(BROKEN, 'b.mmd'))
        waitForRender()

        expect(result.current).toMatchObject({ svgForDisplay: null, isStale: false, isPending: false })
        expect(result.current.error).toMatch(/\S/)
    })
})
