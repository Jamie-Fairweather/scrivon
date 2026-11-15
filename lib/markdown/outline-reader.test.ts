import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutlineHeading } from '@/lib/markdown/document-outline'
import type { OutlineRequest, OutlineResponse } from '@/lib/markdown/outline-reader'

class FakeWorker {
    static instances: FakeWorker[] = []
    static throwOnCreate = false

    posted: OutlineRequest[] = []
    terminated = false
    private listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

    constructor() {
        if (FakeWorker.throwOnCreate) throw new Error('Workers are blocked')
        FakeWorker.instances.push(this)
    }

    addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    }

    postMessage(message: OutlineRequest) {
        this.posted.push(message)
    }

    terminate() {
        this.terminated = true
    }

    emit(type: string, data?: OutlineResponse) {
        for (const listener of this.listeners.get(type) ?? []) listener({ data })
    }

    answer(request: OutlineRequest, headings: OutlineHeading[]) {
        this.emit('message', { id: request.id, headings })
    }
}

const INTRO: OutlineHeading = { id: 'intro', level: 1, text: 'Intro', line: 1 }

async function loadReader() {
    const { createOutlineReader } = await import('@/lib/markdown/outline-reader')
    const onRead = vi.fn<(key: string, headings: OutlineHeading[]) => void>()
    return { reader: createOutlineReader(onRead), onRead }
}

function onlyWorker(): FakeWorker {
    expect(FakeWorker.instances).toHaveLength(1)
    return FakeWorker.instances[0]!
}

beforeEach(() => {
    FakeWorker.instances = []
    FakeWorker.throwOnCreate = false
    vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('createOutlineReader', () => {
    it('reads the text in a worker and reports the headings for its key', async () => {
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')
        const worker = onlyWorker()
        expect(worker.posted).toEqual([{ id: expect.any(Number), source: '# Intro' }])
        expect(onRead).not.toHaveBeenCalled()

        worker.answer(worker.posted[0]!, [INTRO])
        expect(onRead).toHaveBeenCalledWith('a.md', [INTRO])
    })

    it('reads only the newest text that came in while the worker was busy', async () => {
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# One')
        reader.read('a.md', '# One t')
        reader.read('a.md', '# One two')
        const worker = onlyWorker()
        expect(worker.posted.map((request) => request.source)).toEqual(['# One'])

        worker.answer(worker.posted[0]!, [])
        expect(worker.posted.map((request) => request.source)).toEqual(['# One', '# One two'])

        worker.answer(worker.posted[1]!, [INTRO])
        expect(onRead).toHaveBeenLastCalledWith('a.md', [INTRO])
        expect(onRead).toHaveBeenCalledTimes(2)
    })

    it('ignores an answer to a request it did not send', async () => {
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')
        const worker = onlyWorker()
        worker.emit('message', { id: 999, headings: [INTRO] })

        expect(onRead).not.toHaveBeenCalled()
    })

    it('reads on the main thread when workers are not supported', async () => {
        vi.stubGlobal('Worker', undefined)
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')

        expect(onRead).toHaveBeenCalledWith('a.md', [INTRO])
    })

    it('reads on the main thread when the worker cannot be made', async () => {
        FakeWorker.throwOnCreate = true
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')

        expect(onRead).toHaveBeenCalledWith('a.md', [INTRO])
    })

    it('reads on the main thread from then on when the worker fails, starting with the text it was reading', async () => {
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')
        const worker = onlyWorker()
        worker.emit('error')

        expect(worker.terminated).toBe(true)
        expect(onRead).toHaveBeenCalledWith('a.md', [INTRO])

        reader.read('b.md', '## Next')
        expect(onRead).toHaveBeenLastCalledWith('b.md', [{ id: 'next', level: 2, text: 'Next', line: 1 }])
        expect(FakeWorker.instances).toHaveLength(1)
    })

    it('stops the worker when disposed, and drops its late answer', async () => {
        const { reader, onRead } = await loadReader()

        reader.read('a.md', '# Intro')
        const worker = onlyWorker()
        reader.dispose()
        worker.answer(worker.posted[0]!, [INTRO])
        reader.read('a.md', '# Again')

        expect(worker.terminated).toBe(true)
        expect(onRead).not.toHaveBeenCalled()
    })
})
