import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderRequest, RenderResponse } from '@/lib/mermaid/render-worker-core'

const renderMermaidDiagram = vi.hoisted(() =>
    vi.fn((source: string) => {
        if (source.startsWith('bad')) throw new Error(`Parse error in ${source}`)
        return `<svg>${source}</svg>`
    })
)

vi.mock('@/lib/mermaid/render', () => ({ renderMermaidDiagram }))

class FakeWorker {
    static instances: FakeWorker[] = []
    static throwOnCreate = false

    posted: RenderRequest[] = []
    terminated = false
    private listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

    constructor() {
        if (FakeWorker.throwOnCreate) throw new Error('Workers are blocked')
        FakeWorker.instances.push(this)
    }

    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    postMessage(message: RenderRequest) {
        this.posted.push(message)
    }

    terminate() {
        this.terminated = true
    }

    emit(type: string, data?: RenderResponse) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
    }

    answer(request: RenderRequest, response: { svg: string } | { message: string }) {
        this.emit(
            'message',
            'svg' in response ? { type: 'rendered', id: request.id, svg: response.svg } : { type: 'failed', id: request.id, ...response }
        )
    }
}

async function loadClient() {
    vi.resetModules()
    return import('@/lib/mermaid/render-client')
}

function onlyWorker(): FakeWorker {
    expect(FakeWorker.instances).toHaveLength(1)
    return FakeWorker.instances[0]
}

beforeEach(() => {
    vi.useFakeTimers()
    FakeWorker.instances = []
    FakeWorker.throwOnCreate = false
    renderMermaidDiagram.mockClear()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('renderMermaidDiagramAsync', () => {
    it('renders on the main thread when workers are not supported', async () => {
        vi.stubGlobal('Worker', undefined)
        const { renderMermaidDiagramAsync } = await loadClient()

        await expect(renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'a.mmd')).resolves.toBe('<svg>graph TD</svg>')
        await expect(renderMermaidDiagramAsync('bad', 'scrivon-light', 'a.mmd')).rejects.toThrow('Parse error in bad')
    })

    it('renders on the main thread when the worker cannot be created', async () => {
        FakeWorker.throwOnCreate = true
        const { renderMermaidDiagramAsync } = await loadClient()

        await expect(renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'a.mmd')).resolves.toBe('<svg>graph TD</svg>')
    })

    it('lays the diagram out in the worker, off the main thread (P01)', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const result = renderMermaidDiagramAsync('graph TD', 'scrivon-dark', 'a.mmd')
        const worker = onlyWorker()
        worker.emit('message', { type: 'ready' })
        expect(worker.posted).toEqual([{ id: expect.any(Number), source: 'graph TD', themeId: 'scrivon-dark' }])

        worker.answer(worker.posted[0], { svg: '<svg>from worker</svg>' })

        await expect(result).resolves.toBe('<svg>from worker</svg>')
        expect(renderMermaidDiagram).not.toHaveBeenCalled()
    })

    it('passes on parse errors from the worker', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const result = renderMermaidDiagramAsync('bad', 'scrivon-light', 'a.mmd')
        const worker = onlyWorker()
        worker.answer(worker.posted[0], { message: 'Invalid mermaid header' })

        await expect(result).rejects.toThrow('Invalid mermaid header')
    })

    it('shares one render between identical requests', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const canvas = renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'a.mmd')
        const exportMenu = renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'a.mmd')
        const worker = onlyWorker()
        expect(worker.posted).toHaveLength(1)

        worker.answer(worker.posted[0], { svg: '<svg/>' })

        await expect(canvas).resolves.toBe('<svg/>')
        await expect(exportMenu).resolves.toBe('<svg/>')
    })

    it('shares one render between documents showing the same text, like an expanded diagram and its block (N18)', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const block = renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'notes.md:block:1')
        const expanded = renderMermaidDiagramAsync('graph TD', 'scrivon-light', 'notes.md:expanded:1')
        const worker = onlyWorker()
        expect(worker.posted).toHaveLength(1)

        worker.answer(worker.posted[0], { svg: '<svg/>' })

        await expect(block).resolves.toBe('<svg/>')
        await expect(expanded).resolves.toBe('<svg/>')
    })

    it('keeps a waiting render that another document still wants when one moves on to newer text (N18)', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const busy = renderMermaidDiagramAsync('busy', 'scrivon-light', 'a.mmd')
        const block = renderMermaidDiagramAsync('v1', 'scrivon-light', 'notes.md:block:1')
        const expanded = renderMermaidDiagramAsync('v1', 'scrivon-light', 'notes.md:expanded:1')
        const blockNext = renderMermaidDiagramAsync('v2', 'scrivon-light', 'notes.md:block:1')
        const worker = onlyWorker()

        worker.answer(worker.posted[0], { svg: '<svg>busy</svg>' })
        await expect(busy).resolves.toBe('<svg>busy</svg>')
        expect(worker.posted.map((request) => request.source)).toEqual(['busy', 'v1'])

        worker.answer(worker.posted[1], { svg: '<svg>v1</svg>' })
        await expect(expanded).resolves.toBe('<svg>v1</svg>')
        await expect(block).resolves.toBe('<svg>v1</svg>')
        worker.answer(worker.posted[2], { svg: '<svg>v2</svg>' })
        await expect(blockNext).resolves.toBe('<svg>v2</svg>')
    })

    it("drops waiting renders once their views have gone, so the next tab's diagrams don't wait behind them (N67)", async () => {
        const { renderMermaidDiagramAsync, SupersededRenderError } = await loadClient()
        const leftTab = [new AbortController(), new AbortController()]

        const running = renderMermaidDiagramAsync('first', 'scrivon-light', 'old.md:block:1', leftTab[0].signal)
        const waiting = renderMermaidDiagramAsync('second', 'scrivon-light', 'old.md:block:2', leftTab[1].signal)
        const newTab = renderMermaidDiagramAsync('shown', 'scrivon-light', 'new.md:block:1')
        const worker = onlyWorker()
        for (const controller of leftTab) controller.abort()

        await expect(waiting).rejects.toBeInstanceOf(SupersededRenderError)
        // The one already running finishes, so coming back to that tab finds its picture.
        worker.answer(worker.posted[0], { svg: '<svg>first</svg>' })
        await expect(running).resolves.toBe('<svg>first</svg>')
        expect(worker.posted.map((request) => request.source)).toEqual(['first', 'shown'])
        worker.answer(worker.posted[1], { svg: '<svg>shown</svg>' })
        await expect(newTab).resolves.toBe('<svg>shown</svg>')
    })

    it('keeps a waiting render shared by two views until both have gone (N67)', async () => {
        const { renderMermaidDiagramAsync, SupersededRenderError } = await loadClient()
        const canvas = new AbortController()
        const exportMenu = new AbortController()

        renderMermaidDiagramAsync('busy', 'scrivon-light', 'a.mmd')
        const forCanvas = renderMermaidDiagramAsync('v1', 'scrivon-light', 'b.mmd', canvas.signal)
        const forMenu = renderMermaidDiagramAsync('v1', 'scrivon-light', 'b.mmd', exportMenu.signal)
        const worker = onlyWorker()

        canvas.abort()
        worker.answer(worker.posted[0], { svg: '<svg>busy</svg>' })
        expect(worker.posted.map((request) => request.source)).toEqual(['busy', 'v1'])
        worker.answer(worker.posted[1], { svg: '<svg>v1</svg>' })
        await expect(forMenu).resolves.toBe('<svg>v1</svg>')
        await expect(forCanvas).resolves.toBe('<svg>v1</svg>')

        const later = new AbortController()
        const another = new AbortController()
        renderMermaidDiagramAsync('busy again', 'scrivon-light', 'a.mmd')
        const first = renderMermaidDiagramAsync('v2', 'scrivon-light', 'b.mmd', later.signal)
        const second = renderMermaidDiagramAsync('v2', 'scrivon-light', 'c.mmd', another.signal)
        later.abort()
        another.abort()
        await expect(first).rejects.toBeInstanceOf(SupersededRenderError)
        await expect(second).rejects.toBeInstanceOf(SupersededRenderError)
    })

    it('runs one render at a time and drops a waiting one when newer text comes in', async () => {
        const { renderMermaidDiagramAsync, SupersededRenderError } = await loadClient()

        const first = renderMermaidDiagramAsync('v1', 'scrivon-light', 'a.mmd')
        const waiting = renderMermaidDiagramAsync('v2', 'scrivon-light', 'a.mmd')
        const otherDocument = renderMermaidDiagramAsync('other', 'scrivon-light', 'b.mmd')
        const newest = renderMermaidDiagramAsync('v3', 'scrivon-light', 'a.mmd')
        const worker = onlyWorker()
        expect(worker.posted.map((request) => request.source)).toEqual(['v1'])

        await expect(waiting).rejects.toBeInstanceOf(SupersededRenderError)

        worker.answer(worker.posted[0], { svg: '<svg>v1</svg>' })
        await expect(first).resolves.toBe('<svg>v1</svg>')
        expect(worker.posted.map((request) => request.source)).toEqual(['v1', 'other'])

        worker.answer(worker.posted[1], { svg: '<svg>other</svg>' })
        await expect(otherDocument).resolves.toBe('<svg>other</svg>')
        worker.answer(worker.posted[2], { svg: '<svg>v3</svg>' })
        await expect(newest).resolves.toBe('<svg>v3</svg>')
    })

    it('falls back to the main thread when the worker says it cannot render', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const first = renderMermaidDiagramAsync('v1', 'scrivon-light', 'a.mmd')
        const second = renderMermaidDiagramAsync('other', 'scrivon-light', 'b.mmd')
        const worker = onlyWorker()
        worker.emit('message', { type: 'unavailable', message: 'ELK failed' })

        await expect(first).resolves.toBe('<svg>v1</svg>')
        await expect(second).resolves.toBe('<svg>other</svg>')
        expect(worker.terminated).toBe(true)

        await expect(renderMermaidDiagramAsync('v2', 'scrivon-light', 'a.mmd')).resolves.toBe('<svg>v2</svg>')
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('falls back to the main thread when the worker script fails to load', async () => {
        const { renderMermaidDiagramAsync } = await loadClient()

        const result = renderMermaidDiagramAsync('v1', 'scrivon-light', 'a.mmd')
        onlyWorker().emit('error')

        await expect(result).resolves.toBe('<svg>v1</svg>')
    })

    it('falls back to the main thread when the worker never starts', async () => {
        const { renderMermaidDiagramAsync, WORKER_START_TIMEOUT_MS } = await loadClient()

        const result = renderMermaidDiagramAsync('v1', 'scrivon-light', 'a.mmd')
        vi.advanceTimersByTime(WORKER_START_TIMEOUT_MS)

        await expect(result).resolves.toBe('<svg>v1</svg>')
        expect(onlyWorker().terminated).toBe(true)
    })

    it('stops a render that takes too long and starts a fresh worker for the next one', async () => {
        const { renderMermaidDiagramAsync, RENDER_TIMEOUT_MESSAGE, RENDER_TIMEOUT_MS } = await loadClient()

        const slow = renderMermaidDiagramAsync('huge', 'scrivon-light', 'a.mmd')
        const stuck = onlyWorker()
        stuck.emit('message', { type: 'ready' })
        vi.advanceTimersByTime(RENDER_TIMEOUT_MS)

        await expect(slow).rejects.toThrow(RENDER_TIMEOUT_MESSAGE)
        expect(stuck.terminated).toBe(true)
        expect(renderMermaidDiagram).not.toHaveBeenCalled()

        const next = renderMermaidDiagramAsync('small', 'scrivon-light', 'a.mmd')
        expect(FakeWorker.instances).toHaveLength(2)
        const fresh = FakeWorker.instances[1]
        fresh.answer(fresh.posted[0], { svg: '<svg>small</svg>' })
        await expect(next).resolves.toBe('<svg>small</svg>')
    })

    it('ignores messages from a worker it already stopped', async () => {
        const { renderMermaidDiagramAsync, RENDER_TIMEOUT_MS } = await loadClient()

        const slow = renderMermaidDiagramAsync('huge', 'scrivon-light', 'a.mmd')
        const stuck = onlyWorker()
        stuck.emit('message', { type: 'ready' })
        vi.advanceTimersByTime(RENDER_TIMEOUT_MS)
        await expect(slow).rejects.toThrow()

        const next = renderMermaidDiagramAsync('small', 'scrivon-light', 'a.mmd')
        const fresh = FakeWorker.instances[1]
        stuck.answer({ ...fresh.posted[0] }, { svg: '<svg>late</svg>' })
        stuck.emit('error')
        fresh.answer(fresh.posted[0], { svg: '<svg>small</svg>' })

        await expect(next).resolves.toBe('<svg>small</svg>')
        expect(renderMermaidDiagram).not.toHaveBeenCalled()
    })
})
