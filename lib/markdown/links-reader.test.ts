import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentLinks } from '@/lib/markdown/document-links'
import type { LinksRequest, LinksResponse } from '@/lib/markdown/links-reader'

class FakeWorker {
    static instances: FakeWorker[] = []
    static throwOnCreate = false

    posted: LinksRequest[] = []
    terminated = false
    private listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

    constructor() {
        if (FakeWorker.throwOnCreate) throw new Error('Workers are blocked')
        FakeWorker.instances.push(this)
    }

    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    postMessage(message: LinksRequest) {
        this.posted.push(message)
    }

    terminate() {
        this.terminated = true
    }

    emit(type: string, data?: LinksResponse) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
    }
}

const FROM_WORKER: DocumentLinks = { links: [], anchors: ['from-worker'] }

async function loadReader() {
    const { createLinksReader } = await import('@/lib/markdown/links-reader')
    return createLinksReader()
}

beforeEach(() => {
    FakeWorker.instances = []
    FakeWorker.throwOnCreate = false
    vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('createLinksReader', () => {
    it('reads in the worker one text at a time and answers each read with its own result', async () => {
        const reader = await loadReader()
        const first = reader.read('# One')
        const second = reader.read('# Two')
        const worker = FakeWorker.instances[0]!
        expect(worker.posted.map((request) => request.source)).toEqual(['# One'])
        worker.emit('message', { type: 'links-read', id: worker.posted[0]!.id, links: FROM_WORKER })
        expect(await first).toEqual(FROM_WORKER)
        expect(worker.posted.map((request) => request.source)).toEqual(['# One', '# Two'])
        worker.emit('message', { type: 'links-read', id: worker.posted[1]!.id, links: { links: [], anchors: ['two'] } })
        expect(await second).toEqual({ links: [], anchors: ['two'] })
    })

    it('reads only the newest waiting text of a document, and rejects the ones it replaced', async () => {
        const { createLinksReader, LinksReadSuperseded } = await import('@/lib/markdown/links-reader')
        const reader = createLinksReader()
        const running = reader.read('# Typing 1', 'doc')
        const replaced = reader.read('# Typing 2', 'doc')
        const otherTab = reader.read('# Other', 'other')
        const newest = reader.read('# Typing 3', 'doc')
        const worker = FakeWorker.instances[0]!
        await expect(replaced).rejects.toBeInstanceOf(LinksReadSuperseded)

        worker.emit('message', { type: 'links-read', id: worker.posted[0]!.id, links: FROM_WORKER })
        expect(await running).toEqual(FROM_WORKER)
        worker.emit('message', { type: 'links-read', id: worker.posted[1]!.id, links: { links: [], anchors: ['other'] } })
        expect(await otherTab).toEqual({ links: [], anchors: ['other'] })
        worker.emit('message', { type: 'links-read', id: worker.posted[2]!.id, links: { links: [], anchors: ['three'] } })
        expect(await newest).toEqual({ links: [], anchors: ['three'] })
        // The replaced text never reached the worker, and nothing waits on it.
        expect(worker.posted.map((request) => request.source)).toEqual(['# Typing 1', '# Other', '# Typing 3'])
    })

    it('reads on the main thread when the worker cannot start', async () => {
        FakeWorker.throwOnCreate = true
        const reader = await loadReader()
        expect((await reader.read('# Main thread')).anchors).toEqual(['main-thread'])
    })

    it('reads what the worker had not answered on the main thread when it fails, and everything after', async () => {
        const reader = await loadReader()
        const running = reader.read('# Lost')
        const waiting = reader.read('# Queued')
        const worker = FakeWorker.instances[0]!
        worker.emit('error')
        expect(worker.terminated).toBe(true)
        expect((await running).anchors).toEqual(['lost'])
        expect((await waiting).anchors).toEqual(['queued'])
        expect((await reader.read('[a](b.md)')).links.map((link) => link.url)).toEqual(['b.md'])
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('answers waiting reads with nothing once disposed', async () => {
        const reader = await loadReader()
        const running = reader.read('# Never')
        const waiting = reader.read('# Never either')
        reader.dispose()
        expect(await running).toEqual({ links: [], anchors: [] })
        expect(await waiting).toEqual({ links: [], anchors: [] })
        expect(FakeWorker.instances[0]!.terminated).toBe(true)
    })
})

it('the worker answers each request with the links of its text', async () => {
    let listener: ((event: { data: LinksRequest }) => void) | undefined
    const postMessage = vi.fn<(message: LinksResponse) => void>()
    vi.stubGlobal('addEventListener', (type: string, fn: typeof listener) => {
        if (type === 'message') listener = fn
    })
    vi.stubGlobal('postMessage', postMessage)

    await import('@/lib/markdown/links.worker')
    listener!({ data: { id: 3, source: '## Setup\n\n[a](b.md)' } })

    const [answer] = postMessage.mock.calls[0]!
    expect(answer).toMatchObject({ type: 'links-read', id: 3, links: { anchors: ['setup'], links: [{ kind: 'link', url: 'b.md' }] } })
})
