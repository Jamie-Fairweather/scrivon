import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { clearSvgCache } from '@/lib/mermaid/svg-cache'
import type { AppThemeId } from '@/lib/theme/catalog'

const theme = vi.hoisted(() => ({ id: 'scrivon-light' }))

/** When `on`, renders wait in `jobs` until a test finishes them, like a slow diagram in the worker. */
const slow = vi.hoisted(() => ({ on: false, jobs: [] as { source: string; finish: () => void }[] }))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: theme.id }),
}))

vi.mock('@/lib/mermaid/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/render')>()
    return { ...actual, renderMermaidDiagram: vi.fn(actual.renderMermaidDiagram) }
})

vi.mock('@/lib/mermaid/render-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/render-client')>()
    const { renderMermaidDiagram: render } = await import('@/lib/mermaid/render')
    return {
        ...actual,
        renderMermaidDiagramAsync: (source: string, themeId: AppThemeId, documentKey: string) => {
            if (!slow.on) return actual.renderMermaidDiagramAsync(source, themeId, documentKey)
            return new Promise<string>((resolve, reject) => {
                slow.jobs.push({
                    source,
                    finish: () => {
                        try {
                            resolve(render(source, themeId))
                        } catch (err) {
                            reject(err)
                        }
                    },
                })
            })
        },
    }
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

async function finishSlowRender() {
    await act(async () => {
        slow.jobs.shift()!.finish()
    })
}

function renderEditor(source: string, documentKey = 'a.mmd') {
    return renderHook(({ source }) => useMermaidSvg(source, documentKey), { initialProps: { source } })
}

beforeEach(() => {
    vi.useFakeTimers()
    theme.id = 'scrivon-light'
    slow.on = false
    slow.jobs = []
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
        const first = renderEditor(V1)
        await waitForRender()
        first.rerender({ source: V2 })
        await waitForRender()
        first.rerender({ source: V3 })
        await waitForRender()
        first.unmount()

        const again = renderHook(() => useMermaidSvg(BROKEN, 'a.mmd'))

        expect(again.result.current.svgForDisplay).toBe(expectedSvg(V3))
    })

    it('falls back to the version on screen after an undo, not the version undone (B14 review)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()
        rerender({ source: V2 })
        await waitForRender()

        rerender({ source: V1 })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: false })

        rerender({ source: BROKEN })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: true })
        expect(result.current.currentError).toMatch(/\S/)
    })

    it('falls back to the version shown after coming back to a document (B14 review)', async () => {
        const first = renderEditor(V1)
        await waitForRender()
        first.rerender({ source: V2 })
        await waitForRender()
        first.unmount()

        const again = renderEditor(V1)
        expect(again.result.current.svgForDisplay).toBe(expectedSvg(V1))
        again.rerender({ source: BROKEN })
        await waitForRender()

        expect(again.result.current.svgForDisplay).toBe(expectedSvg(V1))
    })

    it('reports a syntax error even when an earlier render is still on screen (U02)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()

        rerender({ source: BROKEN })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), currentError: null, isStale: true, isPending: false })

        await waitForRender()
        expect(result.current.svgForDisplay).toBe(expectedSvg(V1))
        expect(result.current.isStale).toBe(true)
        expect(result.current.currentError).toMatch(/\S/)
        // `error` keeps its meaning for views that swap the diagram for an error card: only when there's nothing to show.
        expect(result.current.error).toBeNull()

        rerender({ source: V2 })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), error: null, currentError: null, isStale: false })
    })

    it('shows a known error at once when coming back to broken text (U02 review)', async () => {
        const first = renderEditor(V1)
        await waitForRender()
        first.rerender({ source: BROKEN })
        await waitForRender()
        first.unmount()
        const renders = vi.mocked(renderMermaidDiagram).mock.calls.length

        const again = renderHook(() => useMermaidSvg(BROKEN, 'a.mmd'))

        expect(again.result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: true, error: null })
        expect(again.result.current.currentError).toMatch(/\S/)
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(renders)
    })

    it('does not bring a deleted diagram back when typing starts again (U02)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()

        rerender({ source: '   ' })
        expect(result.current.svgForDisplay).toBeNull()

        rerender({ source: 'f' })
        expect(result.current.svgForDisplay).toBeNull()
        await waitForRender()
        expect(result.current.svgForDisplay).toBeNull()
        expect(result.current.error).toMatch(/\S/)
    })

    it('shows a render that finishes after the text moved on, instead of throwing it away (P01 review)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()
        slow.on = true

        rerender({ source: V2 })
        await waitForRender()
        expect(slow.jobs).toHaveLength(1)
        rerender({ source: V3 })
        await finishSlowRender()

        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), isStale: true })

        rerender({ source: V2 })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), isStale: false })
        await waitForRender()
        expect(slow.jobs).toHaveLength(0)
    })

    it('keeps a render that finishes after the view went away (P01 review)', async () => {
        slow.on = true
        const first = renderEditor(V1)
        await waitForRender(0)
        expect(slow.jobs).toHaveLength(1)
        first.unmount()
        await finishSlowRender()

        const again = renderEditor(V1)

        expect(again.result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: false, isPending: false })
        await waitForRender()
        expect(slow.jobs).toHaveLength(0)
    })

    it('does not bring back a deleted diagram from a render that finished after the text was cleared (P01 review)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()
        slow.on = true
        rerender({ source: V2 })
        await waitForRender()

        rerender({ source: '' })
        await finishSlowRender()
        slow.on = false
        rerender({ source: 'f' })
        await waitForRender()

        expect(result.current.svgForDisplay).toBeNull()
        expect(result.current.error).toMatch(/\S/)
    })

    it('does not start over when only spaces at the end of the text change (P01 review)', async () => {
        slow.on = true
        const { result, rerender } = renderEditor(V1)
        await waitForRender(0)

        rerender({ source: `${V1}\n  ` })
        await waitForRender()
        expect(slow.jobs).toHaveLength(1)

        await finishSlowRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V1), isStale: false })
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
        expect(views.result.current.canvas.currentError).toMatch(/\S/)
        expect(views.result.current.exportMenu.currentError).toBe(views.result.current.canvas.currentError)
    })

    it('lays an edit out once when an expanded Markdown diagram and its block show the same text (N18)', async () => {
        const views = renderHook(
            ({ source }) => ({ block: useMermaidSvg(source, 'notes.md:block:1'), expanded: useMermaidSvg(source, 'notes.md:expanded:1') }),
            { initialProps: { source: V1 } }
        )
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1)

        views.rerender({ source: V2 })
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(2)
        expect(views.result.current.block.svgForDisplay).toBe(expectedSvg(V2))
        expect(views.result.current.expanded.svgForDisplay).toBe(expectedSvg(V2))
    })

    it('reuses a picture another document finished while this one waited for typing to pause (N18)', async () => {
        const block = renderEditor(V1, 'notes.md:block:1')
        await waitForRender()
        const expanded = renderEditor(V1, 'notes.md:expanded:1')
        await waitForRender()
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(1)

        // The expanded view gets each edit a moment after its block.
        block.rerender({ source: V2 })
        await waitForRender(50)
        expanded.rerender({ source: V2 })
        await waitForRender(150)
        expect(renderMermaidDiagram).toHaveBeenCalledTimes(2)
        await waitForRender(100)

        expect(renderMermaidDiagram).toHaveBeenCalledTimes(2)
        expect(expanded.result.current.svgForDisplay).toBe(expectedSvg(V2))
    })

    it('renders a document shown for the first time without waiting, then waits between keystrokes (U38)', async () => {
        const { result, rerender } = renderEditor(V1)
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

    it('keeps the current text on screen after a theme change, not an older version in that theme (U38 review)', async () => {
        theme.id = 'scrivon-dark'
        const { result, rerender } = renderEditor(V1)
        await waitForRender()
        theme.id = 'scrivon-light'
        rerender({ source: V1 })
        await waitForRender(0)
        rerender({ source: V2 })
        await waitForRender()

        theme.id = 'scrivon-dark'
        rerender({ source: V2 })
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), isStale: true })

        await waitForRender(0)
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2, 'scrivon-dark'), isStale: false })
    })

    it('says a diagram with nothing to draw is empty instead of showing a blank or older picture (U39)', async () => {
        const { result, rerender } = renderEditor(V1)
        await waitForRender()

        rerender({ source: 'graph TD' })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: null, dimensions: null, error: null, isPending: false, isEmpty: true })

        rerender({ source: BROKEN })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: null, isEmpty: false })
        expect(result.current.error).toMatch(/\S/)

        rerender({ source: V2 })
        await waitForRender()
        expect(result.current).toMatchObject({ svgForDisplay: expectedSvg(V2), isEmpty: false })
    })

    it('shows the error straight away for a document that never rendered', async () => {
        const { result } = renderHook(() => useMermaidSvg(BROKEN, 'b.mmd'))
        await waitForRender()

        expect(result.current).toMatchObject({ svgForDisplay: null, isStale: false, isPending: false })
        expect(result.current.error).toMatch(/\S/)
        expect(result.current.currentError).toBe(result.current.error)
    })
})
