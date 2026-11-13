import { describe, expect, it, vi } from 'vitest'
import { createSpellcheckClient } from './spellcheck-client'
import type { SpellcheckRequest, SpellcheckResponse } from './spellcheck-worker-core'

type Answer = (request: SpellcheckRequest) => SpellcheckResponse | null

/** A stand-in for the worker: answers each message with `answer`, a moment later, as a real one would. */
class FakeWorker {
    private readonly listeners = { message: new Set<(event: MessageEvent) => void>(), error: new Set<(event: Event) => void>() }
    readonly received: SpellcheckRequest[] = []
    constructor(private readonly answer: Answer) {}
    addEventListener(type: 'message' | 'error', listener: (event: never) => void) {
        this.listeners[type].add(listener as never)
    }
    postMessage(request: SpellcheckRequest) {
        this.received.push(request)
        const response = this.answer(request)
        if (response) queueMicrotask(() => this.reply(response))
    }
    reply(response: SpellcheckResponse) {
        this.listeners.message.forEach((l) => l({ data: response } as MessageEvent))
    }
    fail() {
        this.listeners.error.forEach((l) => l(new Event('error')))
    }
}

function setup(answer: Answer) {
    const workers: FakeWorker[] = []
    const createWorker = vi.fn(() => {
        const worker = new FakeWorker(answer)
        workers.push(worker)
        return worker as unknown as Worker
    })
    return { client: createSpellcheckClient(createWorker), createWorker, workers }
}

describe('spell check client', () => {
    it('starts the worker on the first request only, and gives each request its own answer', async () => {
        const { client, createWorker, workers } = setup((request) =>
            request.type === 'check'
                ? { type: 'checked', id: request.id, misspellings: [{ word: request.text, offset: 0 }] }
                : { type: 'suggested', id: request.id, suggestions: [request.word.toUpperCase()] }
        )
        expect(createWorker).not.toHaveBeenCalled()

        const [checked, suggested] = await Promise.all([client.check('Helo', 'en-GB', ['Scrivon']), client.suggest('helo', 'en-GB', [])])
        expect(checked).toEqual([{ word: 'Helo', offset: 0 }])
        expect(suggested).toEqual(['HELO'])
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(workers[0]!.received[0]).toMatchObject({ type: 'check', text: 'Helo', language: 'en-GB', words: ['Scrivon'] })
    })

    it('runs one check at a time, and drops a waiting check when a newer one comes', async () => {
        const { client, workers } = setup(() => null)
        const sentTexts = () => workers[0]!.received.map((request) => (request.type === 'check' ? request.text : request.word))
        const first = client.check('one', 'en-US', [])
        const second = client.check('two', 'en-US', [])
        const third = client.check('three', 'en-US', [])
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
        await expect(client.check('x', 'en-US', [])).rejects.toThrow('no dictionary')
    })

    it('gives up on a worker that fails to start, without starting another', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { client, createWorker, workers } = setup(() => null)
        const waiting = client.check('x', 'en-US', [])
        workers[0]!.fail()
        await expect(waiting).rejects.toThrow()
        await expect(client.suggest('x', 'en-US', [])).rejects.toThrow()
        expect(createWorker).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(1)
        warn.mockRestore()
    })
})
