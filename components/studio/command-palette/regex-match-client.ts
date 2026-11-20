import type { TextReplacement } from '@/components/studio/command-palette/replace-text'
import type { TextMatch, WorkspaceSearchOptions } from '@/components/studio/command-palette/text-matcher'

/**
 * Runs regular expressions in a Web Worker, never on the main thread: a pattern like '(a+)+$' can
 * backtrack for minutes on one line, and a running regex can't be stopped there. A file that takes too
 * long has its worker terminated, which is the only way to stop it. Used by Find in Workspace, and by
 * anything else that needs regex matches over a file's text (Replace).
 */

/** How long one file may take in the worker. Its clock starts when the file is posted to the idle worker. */
export const REGEX_FILE_TIME_LIMIT_MS = 2000

/**
 * How long a new worker has to say it's ready. A worker whose code fails to load doesn't tell the page
 * (no error event), so without this the first file would time out and be blamed for it.
 */
export const REGEX_WORKER_START_TIMEOUT_MS = 10_000

export type RegexMatchRequest = {
    id: number
    text: string
    query: string
    options: WorkspaceSearchOptions
    /** Null for no limit. */
    maxHits: number | null
    /** Set to have each match's replacement worked out too (findReplacements): the answer is then 'regex-replaced'. */
    replacement?: string | null
}

export type RegexMatchResponse =
    | { type: 'ready' }
    | { type: 'regex-matched'; id: number; matches: TextMatch[]; longLinesSkipped: number }
    | { type: 'regex-replaced'; id: number; replacements: TextReplacement[]; longLinesSkipped: number }
    | { type: 'regex-invalid'; id: number; error: string }

export type MatchFileOptions = {
    /** Leave it out for every match. */
    maxHits?: number
    timeLimitMs: number
    signal?: AbortSignal
}

export type MatchFileResult =
    | { type: 'matches'; matches: TextMatch[]; longLinesSkipped: number }
    /** The file went over the time limit, and its worker was terminated. */
    | { type: 'timedOut' }
    /** No worker could be started, or it failed. Nothing was matched on the main thread instead. */
    | { type: 'unavailable' }
    /** The pattern doesn't compile. Callers that compiled it first with compileTextQuery never see this. */
    | { type: 'invalid'; error: string }
    | { type: 'aborted' }

/** Finds the matches of `query` in `text`, line by line, as matchText does, but in the worker. */
export type MatchFile = (text: string, query: string, options: WorkspaceSearchOptions, matchOptions: MatchFileOptions) => Promise<MatchFileResult>

/** As MatchFileResult, with each match's replacement worked out (findReplacements) in place of the matches alone. */
export type ReplaceFileResult =
    Exclude<MatchFileResult, { type: 'matches' }> | { type: 'replacements'; replacements: TextReplacement[]; longLinesSkipped: number }

/** Finds the matches of `query` in `text` and what `replacement` makes of each, as findReplacements does, but in the worker. */
export type ReplaceFile = (
    text: string,
    query: string,
    options: WorkspaceSearchOptions,
    replacement: string,
    matchOptions: MatchFileOptions
) => Promise<ReplaceFileResult>

export type RegexMatchClient = {
    matchFile: MatchFile
    replaceFile: ReplaceFile
    /** Stops the worker. Waiting files end as unavailable. */
    dispose: () => void
}

type JobResult = MatchFileResult | ReplaceFileResult

type Job = {
    request: RegexMatchRequest
    timeLimitMs: number
    signal?: AbortSignal
    finish: (result: JobResult) => void
}

/**
 * A client for workers made by `createWorker`, started with the first file. One file is in the worker at
 * a time; the next is posted once the last has its answer. A worker that goes over a file's time limit is
 * terminated and the next file starts a new one. If `createWorker` throws, or the worker fails or doesn't
 * start, the files waiting end as unavailable, and the next file tries a new worker.
 */
export function createRegexMatchClient(createWorker: () => Worker): RegexMatchClient {
    let worker: Worker | null = null
    let ready = false
    let startTimer: ReturnType<typeof setTimeout> | null = null
    let fileTimer: ReturnType<typeof setTimeout> | null = null
    let active: Job | null = null
    const queue: Job[] = []
    let nextId = 1

    const clearTimers = () => {
        if (startTimer !== null) clearTimeout(startTimer)
        if (fileTimer !== null) clearTimeout(fileTimer)
        startTimer = null
        fileTimer = null
    }

    const stopWorker = () => {
        clearTimers()
        worker?.terminate()
        worker = null
        ready = false
    }

    /** Ends the job in the worker. The worker is only stopped when told to. */
    const finishActive = (result: JobResult, terminate: boolean) => {
        const job = active
        active = null
        if (terminate) stopWorker()
        else if (fileTimer !== null) {
            clearTimeout(fileTimer)
            fileTimer = null
        }
        job?.finish(result)
    }

    /** The worker can't be used: everything in it or waiting for it ends as unavailable. */
    const fail = (...cause: unknown[]) => {
        if (cause.length > 0) console.warn("Regular expression search isn't available.", ...cause)
        const jobs = [...(active ? [active] : []), ...queue.splice(0)]
        active = null
        stopWorker()
        for (const job of jobs) job.finish({ type: 'unavailable' })
    }

    const start = (): Worker => {
        const created = createWorker()
        created.addEventListener('message', (event: MessageEvent<RegexMatchResponse>) => {
            if (created !== worker) return
            const message = event.data
            if (message.type === 'ready') {
                ready = true
                if (startTimer !== null) clearTimeout(startTimer)
                startTimer = null
                pump()
                return
            }
            if (!active || message.id !== active.request.id) return
            if (message.type === 'regex-matched') {
                finishActive({ type: 'matches', matches: message.matches, longLinesSkipped: message.longLinesSkipped }, false)
            } else if (message.type === 'regex-replaced') {
                finishActive({ type: 'replacements', replacements: message.replacements, longLinesSkipped: message.longLinesSkipped }, false)
            } else {
                finishActive({ type: 'invalid', error: message.error }, false)
            }
            pump()
        })
        const onFailure = (event: Event) => {
            if (created === worker) fail(event)
        }
        created.addEventListener('error', onFailure)
        created.addEventListener('messageerror', onFailure)
        startTimer = setTimeout(() => {
            if (created === worker) fail(new Error(`The regex worker didn't start within ${REGEX_WORKER_START_TIMEOUT_MS / 1000} seconds.`))
        }, REGEX_WORKER_START_TIMEOUT_MS)
        return created
    }

    function pump(): void {
        if (active) return
        // One abort can end several files: those still waiting are dropped before a worker is started for them.
        while (queue[0]?.signal?.aborted) queue.shift()!.finish({ type: 'aborted' })
        if (queue.length === 0) return
        if (!worker) {
            try {
                worker = start()
            } catch (err) {
                fail(err)
                return
            }
        }
        // Posted once the worker has loaded, so a file's clock only counts its own matching.
        if (!ready) return

        const job = queue.shift()!
        active = job
        worker.postMessage(job.request)
        fileTimer = setTimeout(() => {
            if (active !== job) return
            finishActive({ type: 'timedOut' }, true)
            pump()
        }, job.timeLimitMs)
    }

    const run = (request: Omit<RegexMatchRequest, 'id'>, { timeLimitMs, signal }: MatchFileOptions): Promise<JobResult> => {
        if (signal?.aborted) return Promise.resolve({ type: 'aborted' })
        return new Promise<JobResult>((resolve) => {
            const onAbort = () => {
                if (active === job) {
                    // The only way to stop a regex that is running.
                    finishActive({ type: 'aborted' }, true)
                    pump()
                    return
                }
                const at = queue.indexOf(job)
                if (at !== -1) queue.splice(at, 1)
                job.finish({ type: 'aborted' })
            }
            let done = false
            const job: Job = {
                request: { ...request, id: nextId++, options: { ...request.options } },
                timeLimitMs,
                signal,
                finish: (result) => {
                    if (done) return
                    done = true
                    signal?.removeEventListener('abort', onAbort)
                    resolve(result)
                },
            }
            signal?.addEventListener('abort', onAbort, { once: true })
            queue.push(job)
            pump()
        })
    }

    const matchFile: MatchFile = async (text, query, options, matchOptions) => {
        const result = await run({ text, query, options, maxHits: matchOptions.maxHits ?? null }, matchOptions)
        // Only a request with a replacement is answered with replacements.
        return result.type === 'replacements' ? { type: 'unavailable' } : result
    }

    const replaceFile: ReplaceFile = async (text, query, options, replacement, matchOptions) => {
        const result = await run({ text, query, options, maxHits: matchOptions.maxHits ?? null, replacement }, matchOptions)
        return result.type === 'matches' ? { type: 'unavailable' } : result
    }

    return {
        matchFile,
        replaceFile,
        dispose: () => fail(),
    }
}

let shared: RegexMatchClient | null = null

/** The app's regex worker client, which starts its worker with the first file. */
export function getRegexMatchClient(): RegexMatchClient {
    shared ??= createRegexMatchClient(() => {
        if (typeof Worker === 'undefined') throw new Error('Web Workers are not available.')
        return new Worker(new URL('./regex-match.worker.ts', import.meta.url), { type: 'module' })
    })
    return shared
}

/** Matches one file's text in the app's regex worker. No hit cap unless `maxHits` is given. */
export const matchFile: MatchFile = (text, query, options, matchOptions) => getRegexMatchClient().matchFile(text, query, options, matchOptions)

/** Works out one file's replacements in the app's regex worker. No cap unless `maxHits` is given. */
export const replaceFile: ReplaceFile = (text, query, options, replacement, matchOptions) =>
    getRegexMatchClient().replaceFile(text, query, options, replacement, matchOptions)
