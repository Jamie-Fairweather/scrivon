import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { clearSvgCache } from '@/lib/mermaid/svg-cache'
import type { AppThemeId } from '@/lib/theme/catalog'

const theme = vi.hoisted(() => ({ id: 'scrivon-light' }))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: theme.id }),
}))

vi.mock('@/lib/mermaid/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/render')>()
    return { ...actual, renderMermaidDiagram: vi.fn(actual.renderMermaidDiagram) }
})

const V1 = 'graph TD\n  A --> B'
const V2 = 'graph TD\n  A --> B --> C'
const V3 = 'graph TD\n  A --> B --> C --> D'
const BROKEN = 'graph\n  A --> B'

function expectedSvg(source: string, themeId: AppThemeId = 'scrivon-light') {
    return vi.mocked(renderMermaidDiagram).getMockImplementation()!(source, themeId)
}

async function waitForRender(ms = 250) {
    await act(async () => {
        vi.advanceTimersByTime(ms)
    })
}

beforeEach(() => {
    vi.useFakeTimers()
    theme.id = 'scrivon-light'
    clearSvgCache()
    vi.mocked(renderMermaidDiagram).mockClear()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('useMermaidSvg', () => {
    it('renders the source after a pause', async () => {
        const { result } = renderHook(() => useMermaidSvg(V1, 'a.mmd'))
        expect(result.current.isPending).toBe(true)

        await waitForRender()

        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        expect(result.current.error).toBeNull()
    })

    it('falls back to the latest render of a document after a remount, not the first one (B14)', async () => {
        const first = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        await waitForRender()
        first.rerender({ source: V2 })
        await waitForRender()
        first.rerender({ source: V3 })
        await waitForRender()
        first.unmount()

        const again = renderHook(() => useMermaidSvg(BROKEN, 'a.mmd'))

        expect(again.result.current.svgForDisplay).toBe(expectedSvg(V3))
    })

    it('reports a syntax error even when an earlier render is still on screen (U02)', async () => {
        const { result, rerender } = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        await waitForRender()

        rerender({ source: BROKEN })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), error: null, isStale: true, isPending: false })

        await waitForRender()
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        expect(result.current.isStale).toBe(true)
        expect(result.current.error).toMatch(/\S/)

        rerender({ source: V2 })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), error: null, isStale: false })
    })

    it('does not bring a deleted diagram back when typing starts again (U02)', async () => {
        const { result, rerender } = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        await waitForRender()

        rerender({ source: '   ' })
        expect(result.current.svgForDisplay).toBeNull()

        rerender({ source: 'f' })
        expect(result.current.svgForDisplay).toBeNull()
        await waitForRender()
        expect(result.current.svgForDisplay).toBeNull()
        expect(result.current.error).toMatch(/\S/)
    })

    it('renders each edit once when two views show the same document (P03)', async () => {
        const views = renderHook(({ source }) => ({ canvas: useMermaidSvg(source, 'a.mmd'), exportMenu: useMermaidSvg(source, 'a.mmd') }), {
            initialProps: { source: V1 },
        })
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1)
        expect(views.result.current.exportMenu.svgForDisplay).toBe(expectedSvg(V1))

        views.rerender({ source: V2 })
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(2)
        expect(views.result.current.canvas.svgForDisplay).toBe(expectedSvg(V2))

        views.rerender({ source: BROKEN })
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(3)
        expect(views.result.current.canvas.error).toMatch(/\S/)
        expect(views.result.current.exportMenu.error).toBe(views.result.current.canvas.error)
    })

    it('renders a document shown for the first time without waiting, then waits between keystrokes (U38)', async () => {
        const { result, rerender } = renderHook(({ source }) => useMermaidSvg(source, 'a.mmd'), { initialProps: { source: V1 } })
        await waitForRender(0)
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))

        rerender({ source: V2 })
        await waitForRender(0)
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        await waitForRender()
        expect(result.current.svgForDisplay).toBe(expectedSvg(V2))
    })

    it('keeps the diagram on screen while it re-renders for a new theme (U38)', async () => {
        const { result, rerender } = renderHook(() => useMermaidSvg(V1, 'a.mmd'))
        await waitForRender()

        theme.id = 'scrivon-dark'
        rerender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: true, isPending: false })

        await waitForRender(0)
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1, 'scrivon-dark'), isStale: false })

        theme.id = 'scrivon-light'
        rerender()
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
    })

    it('shows the error straight away for a document that never rendered', async () => {
        const { result } = renderHook(() => useMermaidSvg(BROKEN, 'b.mmd'))
        await waitForRender()

        expect(result.current).toMatchObject({ svgForDisplay: null, isStale: false, isPending: false })
        expect(result.current.error).toMatch(/\S/)
    })
})
