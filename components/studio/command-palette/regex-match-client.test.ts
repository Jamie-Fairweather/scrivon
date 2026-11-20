import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    createRegexMatchClient,
    REGEX_FILE_TIME_LIMIT_MS,
    REGEX_WORKER_START_TIMEOUT_MS,
    type RegexMatchRequest,
    type RegexMatchResponse,
} from '@/components/studio/command-palette/regex-match-client'
import { findReplacements } from '@/components/studio/command-palette/replace-text'
import { compileTextQuery, matchText, PLAIN_SEARCH_OPTIONS } from '@/components/studio/command-palette/text-matcher'

const REGEX = { ...PLAIN_SEARCH_OPTIONS, useRegex: true }

type Answer = (request: RegexMatchRequest) => RegexMatchResponse | null

/** Answers as the real worker does. */
const realAnswer: Answer = (request) => {
    const compiled = compileTextQuery(request.query, request.options)
    if (!compiled.ok) return { type: 'regex-invalid', id: request.id, error: compiled.error }
    if (typeof request.replacement === 'string') {
        const { replacements, longLinesSkipped } = findReplacements(request.text, compiled.matcher, request.replacement, request.maxHits ?? undefined)
        return { type: 'regex-replaced', id: request.id, replacements, longLinesSkipped }
    }
    const { matches, longLinesSkipped } = matchText(request.text, compiled.matcher, request.maxHits ?? undefined)
    return { type: 'regex-matched', id: request.id, matches, longLinesSkipped }
}

/**
 * A stand-in for the worker: says it's ready once loaded and answers each file a moment later, as a
 * real one would. An answer of null is a worker stuck on that file. With `ready: false` it never loads.
 */
class FakeWorker {
    private readonly listeners = {
        message: new Set<(event: MessageEvent) => void>(),
        error: new Set<(event: Event) => void>(),
        messageerror: new Set<(event: Event) => void>(),
    }
    readonly received: RegexMatchRequest[] = []
    terminated = false
    constructor(
        private readonly answer: Answer,
        ready: boolean
    ) {
        if (ready) queueMicrotask(() => this.reply({ type: 'ready' }))
    }
    addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: never) => void) {
        this.listeners[type].add(listener as never)
    }
    postMessage(request: RegexMatchRequest) {
        if (this.terminated) throw new Error('posted to a terminated worker')
        this.received.push(request)
        const response = this.answer(request)
        if (response) queueMicrotask(() => this.reply(response))
    }
    reply(message: RegexMatchResponse) {
        if (this.terminated) return
        this.listeners.message.forEach((l) => l({ data: message } as MessageEvent))
    }
    fail(type: 'error' | 'messageerror' = 'error') {
        this.listeners[type].forEach((l) => l(new Event(type)))
    }
    terminate() {
        this.terminated = true
    }
}

function setup(answer: Answer = realAnswer, { ready = true } = {}) {
    const workers: FakeWorker[] = []
    const createWorker = vi.fn(() => {
        const worker = new FakeWorker(answer, ready)
        workers.push(worker)
        return worker as unknown as Worker
    })
    return { client: createRegexMatchClient(createWorker), createWorker, workers }
}

const limit = { timeLimitMs: REGEX_FILE_TIME_LIMIT_MS }

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('regex match client', () => {
    it('matches a file in the worker, with no hit cap unless one is given', async () => {
        const { client, createWorker } = setup()
        const text = 'a1 a2\nb a3\n' + 'a9 '.repeat(500)

        const all = await client.matchFile(text, 'a\\d', REGEX, limit)
        expect(all).toMatchObject({ type: 'matches', longLinesSkipped: 0 })
        expect(all.type === 'matches' && all.matches).toHaveLength(503)
        expect(all.type === 'matches' && all.matches[2]).toEqual({ lineIndex: 1, start: 2, length: 2 })

        const capped = await client.matchFile(text, 'a\\d', REGEX, { ...limit, maxHits: 2 })
        expect(capped.type === 'matches' && capped.matches).toHaveLength(2)
        expect(createWorker).toHaveBeenCalledTimes(1)
    })

    it("works out a file's replacements in the worker, through the same queue and time limit", async () => {
        const { client, workers } = setup()
        const result = await client.replaceFile('ab ab', '(a)(b)', REGEX, '$2$1', { ...limit, maxHits: 1 })
        expect(result).toEqual({
            type: 'replacements',
            replacements: [{ lineIndex: 0, start: 0, length: 2, oldText: 'ab', newText: 'ba' }],
            longLinesSkipped: 0,
        })
        expect(workers[0]!.received[0]).toMatchObject({ replacement: '$2$1', maxHits: 1 })
        // A plain match after it is answered with matches, not replacements.
        await expect(client.matchFile('ab', 'a', REGEX, limit)).resolves.toMatchObject({ type: 'matches' })
    })

    it('sends one file at a time, the next only after the last reply', async () => {
        const { client, workers } = setup(() => null)
        const first = client.matchFile('a', 'a', REGEX, limit)
        const second = client.matchFile('aa', 'a', REGEX, limit)
        await vi.waitFor(() => expect(workers[0]?.received).toHaveLength(1))
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(workers[0]!.received.map((r) => r.text)).toEqual(['a'])

        workers[0]!.reply(realAnswer(workers[0]!.received[0]!)!)
        await expect(first).resolves.toMatchObject({ type: 'matches' })
        expect(workers[0]!.received.map((r) => r.text)).toEqual(['a', 'aa'])
        workers[0]!.reply(realAnswer(workers[0]!.received[1]!)!)
        await expect(second).resolves.toMatchObject({ type: 'matches' })
    })

    it('says the pattern is invalid when the worker cannot compile it', async () => {
        const { client } = setup()
        await expect(client.matchFile('x', '(', REGEX, limit)).resolves.toEqual({
            type: 'invalid',
            error: 'Invalid regular expression: Unterminated group',
        })
    })

    it('terminates a worker that never replies once the time limit passes, and starts a new one for the next file', async () => {
        vi.useFakeTimers()
        const stuck = (request: RegexMatchRequest) => (request.text === 'stuck' ? null : realAnswer(request))
        const { client, workers } = setup(stuck)

        const pending = client.matchFile('stuck', '(a+)+$', REGEX, limit)
        await vi.advanceTimersByTimeAsync(REGEX_FILE_TIME_LIMIT_MS - 1)
        expect(workers[0]!.terminated).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(pending).resolves.toEqual({ type: 'timedOut' })
        expect(workers[0]!.terminated).toBe(true)

        const next = client.matchFile('aa', 'a', REGEX, limit)
        await vi.advanceTimersByTimeAsync(0)
        await expect(next).resolves.toMatchObject({ type: 'matches' })
        expect(workers).toHaveLength(2)
    })

    it("starts a file's clock when the file is posted to the idle worker, not when it was queued", async () => {
        vi.useFakeTimers()
        const slow: Answer = (request) => {
            const response = realAnswer(request)
            // Each file takes most of the limit, so files queued together would run out if their clocks shared a start.
            setTimeout(() => workers[0]!.reply(response!), REGEX_FILE_TIME_LIMIT_MS - 100)
            return null
        }
        const { client, workers } = setup(slow)

        const results = Promise.all([1, 2, 3].map(() => client.matchFile('a', 'a', REGEX, limit)))
        await vi.advanceTimersByTimeAsync(3 * REGEX_FILE_TIME_LIMIT_MS)
        expect((await results).map((r) => r.type)).toEqual(['matches', 'matches', 'matches'])
        expect(workers).toHaveLength(1)
    })

    it('gets through 2,000 small files without stopping', async () => {
        vi.useFakeTimers()
        const { client, workers } = setup()
        const results = Promise.all(Array.from({ length: 2000 }, (_, i) => client.matchFile(`line ${i}`, '\\d+', REGEX, limit)))
        await vi.advanceTimersByTimeAsync(0)
        const done = await results
        expect(done.every((r) => r.type === 'matches' && r.matches.length === 1)).toBe(true)
        expect(workers).toHaveLength(1)
        expect(workers[0]!.terminated).toBe(false)
    })

    it('is unavailable when the worker cannot be created, and runs nothing on the main thread', async () => {
        const createWorker = vi.fn(() => {
            throw new Error('no workers here')
        })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const client = createRegexMatchClient(createWorker)
        const exec = vi.spyOn(RegExp.prototype, 'exec')
        await expect(client.matchFile('aaa', 'a', REGEX, limit)).resolves.toEqual({ type: 'unavailable' })
        expect(exec).not.toHaveBeenCalled()
        // The next file tries again.
        await expect(client.matchFile('aaa', 'a', REGEX, limit)).resolves.toEqual({ type: 'unavailable' })
        expect(createWorker).toHaveBeenCalledTimes(2)
    })

    it.each(['error', 'messageerror'] as const)('is unavailable when the worker fires %s, for the file in it and those waiting', async (type) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { client, workers } = setup(() => null)
        const first = client.matchFile('a', 'a', REGEX, limit)
        const second = client.matchFile('b', 'b', REGEX, limit)
        await vi.waitFor(() => expect(workers[0]?.received).toHaveLength(1))
        workers[0]!.fail(type)
        await expect(first).resolves.toEqual({ type: 'unavailable' })
        await expect(second).resolves.toEqual({ type: 'unavailable' })
        expect(workers[0]!.terminated).toBe(true)
    })

    it("is unavailable when the worker never says it's ready", async () => {
        vi.useFakeTimers()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { client, workers } = setup(realAnswer, { ready: false })
        const pending = client.matchFile('a', 'a', REGEX, limit)
        await vi.advanceTimersByTimeAsync(REGEX_WORKER_START_TIMEOUT_MS)
        await expect(pending).resolves.toEqual({ type: 'unavailable' })
        expect(workers[0]!.received).toHaveLength(0)
        expect(workers[0]!.terminated).toBe(true)
    })

    it('terminates the worker when the file in it is aborted, and drops aborted files still waiting', async () => {
        const { client, workers } = setup(() => null)
        const controller = new AbortController()
        const inWorker = client.matchFile('a', 'a', REGEX, { ...limit, signal: controller.signal })
        const waiting = client.matchFile('b', 'b', REGEX, { ...limit, signal: controller.signal })
        await vi.waitFor(() => expect(workers[0]?.received).toHaveLength(1))

        controller.abort()
        await expect(inWorker).resolves.toEqual({ type: 'aborted' })
        await expect(waiting).resolves.toEqual({ type: 'aborted' })
        expect(workers[0]!.terminated).toBe(true)
        expect(workers).toHaveLength(1)
    })

    it('answers at once for a file aborted before it was sent', async () => {
        const { client, createWorker } = setup()
        const controller = new AbortController()
        controller.abort()
        await expect(client.matchFile('a', 'a', REGEX, { ...limit, signal: controller.signal })).resolves.toEqual({ type: 'aborted' })
        expect(createWorker).not.toHaveBeenCalled()
    })
})
