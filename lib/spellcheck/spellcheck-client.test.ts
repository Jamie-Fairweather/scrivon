import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpellcheckClient, SPELLCHECK_START_TIMEOUT_MS } from './spellcheck-client'
import type { SpellcheckRequest, SpellcheckWorkerMessage } from './spellcheck-worker-core'

const DOC = 'inmemory://scrivon/document-1'

type Answer = (request: SpellcheckRequest) => SpellcheckWorkerMessage | null

/**
 * A stand-in for the worker: says it's ready once it has loaded, and answers each message with
 * `answer`, a moment later, as a real one would. With `ready: false` it is one that failed to load.
 */
class FakeWorker {
    private readonly listeners = { message: new Set<(event: MessageEvent) => void>(), error: new Set<(event: Event) => void>() }
    readonly received: SpellcheckRequest[] = []
    terminated = false
    constructor(
        private readonly answer: Answer,
        ready: boolean
    ) {
        if (ready) queueMicrotask(() => this.reply({ type: 'ready' }))
    }
    addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
        this.listeners[type].add(listener as never)
    }
    postMessage(request: SpellcheckRequest) {
        this.received.push(request)
        const response = this.answer(request)
        if (response) queueMicrotask(() => this.reply(response))
    }
    reply(message: SpellcheckWorkerMessage) {
        this.listeners.message.forEach((l) => l({ data: message } as MessageEvent))
    }
    fail() {
        this.listeners.error.forEach((l) => l(new Event('error')))
    }
    terminate() {
        this.terminated = true
    }
}

function setup(answer: Answer, { ready = true } = {}) {
    const workers: FakeWorker[] = []
    const createWorker = vi.fn(() => {
        const worker = new FakeWorker(answer, ready)
        workers.push(worker)
        return worker as unknown as Worker
    })
    return { client: createSpellcheckClient(createWorker), createWorker, workers }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('spell check client', () => {
    it('starts the worker on the first request only, and gives each request its own answer', async () => {
        const { client, createWorker, workers } = setup((request) =>
            request.type === 'check'
                ? { type: 'checked', id: request.id, misspellings: [{ word: request.text, offset: 0 }] }
                : { type: 'suggested', id: request.id, suggestions: [request.word.toUpperCase()] }
        )
        expect(createWorker).not.toHaveBeenCalled()

        const [checked, suggested] = await Promise.all([client.check('Helo', 'en-GB', ['Scrivon'], DOC), client.suggest('helo', 'en-GB', [])])
        expect(checked).toEqual([{ word: 'Helo', offset: 0 }])
        expect(suggested).toEqual(['HELO'])
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(workers[0]!.received[0]).toMatchObject({ type: 'check', text: 'Helo', document: DOC, language: 'en-GB', words: ['Scrivon'] })
    })

    it('runs one check at a time, and drops a waiting check when a newer one comes', async () => {
        const { client, workers } = setup(() => null)
        const sentTexts = () => workers[0]!.received.map((request) => (request.type === 'check' ? request.text : request.word))
        const first = client.check('one', 'en-US', [], DOC)
        const second = client.check('two', 'en-US', [], DOC)
        const third = client.check('three', 'en-US', [], DOC)
        expect(sentTexts()).toEqual(['one'])

        workers[0]!.reply({ type: 'checked', id: workers[0]!.received[0]!.id, misspellings: [] })
        expect(await first).toEqual([])
        await expect(second).rejects.toThrow('newer')
        expect(sentTexts()).toEqual(['one', 'three'])

        workers[0]!.reply({ type: 'checked', id: workers[0]!.received[1]!.id, misspellings: [{ word: 'three', offset: 0 }] })
        expect(await third).toEqual([{ word: 'three', offset: 0 }])
    })

    it('rejects a request the worker could not answer', async () => {
        const { client } = setup((request) => ({ type: 'failed', id: request.id, message: 'no dictionary' }))
        await expect(client.check('x', 'en-US', [], DOC)).rejects.toThrow('no dictionary')
    })

    it('gives up on a worker that fails to start, without starting another', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { client, createWorker, workers } = setup(() => null)
        const waiting = client.check('x', 'en-US', [], DOC)
        workers[0]!.fail()
        await expect(waiting).rejects.toThrow()
        await expect(client.suggest('x', 'en-US', [])).rejects.toThrow()
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    it('gives up on a worker that throws as it is made, and still answers later checks', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const failure = new Error('no workers here')
        const createWorker = vi.fn((): Worker => {
            throw failure
        })
        const client = createSpellcheckClient(createWorker)
        await expect(client.check('x', 'en-US', [], DOC)).rejects.toThrow("couldn't start")
        // The first check is over, so this one isn't left waiting behind it.
        await expect(client.check('y', 'en-US', [], DOC)).rejects.toThrow("couldn't start")
        await expect(client.suggest('x', 'en-US', [])).rejects.toThrow("couldn't start")
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledExactlyOnceWith("The spell check couldn't start.", failure)
        warn.mockRestore()
    })

    // A worker whose code fails as it loads (one of its packages needs a page's `document`, say) sends
    // no error event: it just never answers, so the checks would wait for ever with no sign of why.
    it("gives up on a worker that never says it's ready, and stops it", async () => {
        vi.useFakeTimers()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { client, createWorker, workers } = setup(() => null, { ready: false })
        const waiting = client.check('x', 'en-US', [], DOC)
        const failed = expect(waiting).rejects.toThrow("couldn't start")

        await vi.advanceTimersByTimeAsync(SPELLCHECK_START_TIMEOUT_MS)
        await failed
        expect(workers[0]!.terminated).toBe(true)
        await expect(client.check('y', 'en-US', [], DOC)).rejects.toThrow("couldn't start")
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })

    it('keeps a ready worker past the start-up wait, even with a slow first answer', async () => {
        vi.useFakeTimers()
        const { client, workers } = setup(() => null)
        const waiting = client.check('x', 'en-US', [], DOC)
        await vi.advanceTimersByTimeAsync(SPELLCHECK_START_TIMEOUT_MS * 2)

        workers[0]!.reply({ type: 'checked', id: workers[0]!.received[0]!.id, misspellings: [] })
        expect(await waiting).toEqual([])
        expect(workers[0]!.terminated).toBe(false)
    })
})
