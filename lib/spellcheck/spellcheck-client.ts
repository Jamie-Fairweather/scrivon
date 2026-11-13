import type { SpellcheckLanguage } from '@/lib/spellcheck/languages'
import type { Misspelling, SpellcheckRequest, SpellcheckResponse } from '@/lib/spellcheck/spellcheck-worker-core'

export type { Misspelling }

/**
 * Talks to the spell check worker. Its dictionary and the user's words go with every request. A check
 * also says which document the text is (its model's URI), so the worker can remember what it read there.
 */
export type SpellcheckClient = {
    check(text: string, language: SpellcheckLanguage, words: readonly string[], document: string): Promise<Misspelling[]>
    suggest(word: string, language: SpellcheckLanguage, words: readonly string[]): Promise<string[]>
}

type Pending = { resolve: (response: SpellcheckResponse) => void; reject: (err: Error) => void }

/** Some fields of a request: the rest are the same for every request. */
type RequestBody = { type: 'check'; text: string; document: string } | { type: 'suggest'; word: string }

/**
 * A client for a worker made by `createWorker`, started with the first request. A worker that fails
 * to start isn't tried again: spelling just isn't checked until the app restarts.
 */
export function createSpellcheckClient(createWorker: () => Worker): SpellcheckClient {
    let worker: Worker | null = null
    let broken: Error | null = null
    let nextId = 1
    const pending = new Map<number, Pending>()

    /** Stops using the worker. `cause` is logged with the warning, when there is one. */
    const giveUp = (...cause: unknown[]): Error => {
        broken = new Error("The spell check couldn't start.")
        console.warn(broken.message, ...cause)
        for (const waiting of pending.values()) waiting.reject(broken)
        pending.clear()
        return broken
    }

    const start = (): Worker => {
        const started = createWorker()
        started.addEventListener('message', (event: MessageEvent<SpellcheckResponse>) => {
            const waiting = pending.get(event.data.id)
            pending.delete(event.data.id)
            waiting?.resolve(event.data)
        })
        started.addEventListener('error', () => giveUp())
        return started
    }

    const ask = (body: RequestBody, language: SpellcheckLanguage, words: readonly string[]): Promise<SpellcheckResponse> => {
        if (broken) return Promise.reject(broken)
        try {
            worker ??= start()
        } catch (err) {
            // Rejected, not thrown, so the check that asked still ends and the next one can run.
            return Promise.reject(giveUp(err))
        }
        const id = nextId++
        const request = { ...body, id, language, words: [...words] } as SpellcheckRequest
        return new Promise<SpellcheckResponse>((resolve, reject) => {
            pending.set(id, { resolve, reject })
            worker!.postMessage(request)
        }).then((response) => {
            if (response.type === 'failed') throw new Error(response.message)
            return response
        })
    }

    // One check at a time, and only the newest one waits: an older text would only be checked for nothing.
    let checking = false
    let waiting: { run: () => void; drop: () => void } | null = null

    const checkNow = (text: string, language: SpellcheckLanguage, words: readonly string[], document: string): Promise<Misspelling[]> => {
        checking = true
        return ask({ type: 'check', text, document }, language, words)
            .then((r) => (r.type === 'checked' ? r.misspellings : []))
            .finally(() => {
                checking = false
                const next = waiting
                waiting = null
                next?.run()
            })
    }

    return {
        check: (text, language, words, document) => {
            if (!checking) return checkNow(text, language, words, document)
            waiting?.drop()
            return new Promise<Misspelling[]>((resolve, reject) => {
                waiting = {
                    run: () => checkNow(text, language, words, document).then(resolve, reject),
                    drop: () => reject(new Error('A newer text replaced this check.')),
                }
            })
        },
        suggest: (word, language, words) =>
            ask({ type: 'suggest', word }, language, words).then((r) => (r.type === 'suggested' ? r.suggestions : [])),
    }
}

let shared: SpellcheckClient | null = null

/** The app's one spell check worker, started the first time something is checked. */
export function getSpellcheckClient(): SpellcheckClient {
    shared ??= createSpellcheckClient(() => new Worker(new URL('./spellcheck.worker.ts', import.meta.url), { type: 'module' }))
    return shared
}
