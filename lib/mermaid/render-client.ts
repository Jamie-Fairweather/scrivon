import { renderMermaidDiagram } from '@/lib/mermaid/render'
import type { RenderRequest, RenderResponse } from '@/lib/mermaid/render-worker-core'
import type { AppThemeId } from '@/lib/theme/catalog'

/**
 * Lays diagrams out in a Web Worker so a big diagram doesn't freeze typing and the window.
 * One render runs at a time; a newer text for the same document replaces one still waiting.
 * Views showing the same text in the same theme share one render, whichever document they belong to.
 * If the worker can't start or can't render, everything quietly runs on the main thread as before.
 */

/** A render taking longer than this is stopped, so a huge or hostile diagram can't tie the worker up. */
export const RENDER_TIMEOUT_MS = 20_000
/** A worker that hasn't said it can render by now is given up on. */
export const WORKER_START_TIMEOUT_MS = 10_000
export const RENDER_TIMEOUT_MESSAGE = 'This diagram is too big to draw. Try splitting it into smaller diagrams.'

/** The render was dropped because a newer text for the same document came in first. */
export class SupersededRenderError extends Error {
    constructor() {
        super('A newer version of this diagram replaced this render.')
        this.name = 'SupersededRenderError'
    }
}

/** One view waiting for a render. */
type Caller = { documentKey: string }

type Job = RenderRequest & {
    /** Theme and text: all that decides the picture. */
    requestKey: string
    /** Views still waiting for it. A job that hasn't started is dropped once none are left. */
    callers: Set<Caller>
    promise: Promise<string>
    resolve: (svg: string) => void
    reject: (err: Error) => void
}

let worker: Worker | null = null
let workerReady = false
let workerUnavailable = false
let startTimer: ReturnType<typeof setTimeout> | null = null
let active: Job | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let nextId = 1
const queue: Job[] = []
/**
 * Requests for the same text in the same theme share one render: the canvas and the export menu, say, or
 * an expanded Markdown diagram and its block in the preview underneath.
 */
const pending = new Map<string, Job>()

function settle(job: Job, result: { svg: string } | { error: Error }): void {
    if ('svg' in result) job.resolve(result.svg)
    else job.reject(result.error)
}

function renderOnMainThread(job: Job): void {
    try {
        settle(job, { svg: renderMermaidDiagram(job.source, job.themeId) })
    } catch (err) {
        settle(job, { error: err instanceof Error ? err : new Error(String(err)) })
    }
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer)
    return null
}

function takeActive(): Job | null {
    const job = active
    active = null
    activeTimer = clearTimer(activeTimer)
    return job
}

function stopWorker(): void {
    worker?.terminate()
    worker = null
    workerReady = false
    startTimer = clearTimer(startTimer)
}

/** The worker can't be used: finish its work, and everything after it, on the main thread. */
function fallBackToMainThread(): void {
    workerUnavailable = true
    stopWorker()
    const job = takeActive()
    if (job) queue.unshift(job)
    pump()
}

function handleMessage(from: Worker, message: RenderResponse): void {
    if (from !== worker) return
    if (message.type === 'ready') {
        workerReady = true
        startTimer = clearTimer(startTimer)
        return
    }
    if (message.type === 'unavailable') {
        fallBackToMainThread()
        return
    }
    if (active?.id !== message.id) return

    const job = takeActive()!
    settle(job, message.type === 'rendered' ? { svg: message.svg } : { error: new Error(message.message) })
    pump()
}

function handleTimeout(): void {
    if (!workerReady) {
        fallBackToMainThread()
        return
    }
    const job = takeActive()
    // The worker is stuck on this diagram; a fresh one starts with the next render.
    stopWorker()
    if (job) settle(job, { error: new Error(RENDER_TIMEOUT_MESSAGE) })
    pump()
}

function getWorker(): Worker | null {
    if (worker || workerUnavailable) return worker
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
        workerUnavailable = true
        return null
    }

    let created: Worker
    try {
        created = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
    } catch {
        workerUnavailable = true
        return null
    }

    created.addEventListener('message', (event: MessageEvent<RenderResponse>) => handleMessage(created, event.data))
    created.addEventListener('error', () => {
        if (created === worker) fallBackToMainThread()
    })
    created.addEventListener('messageerror', () => {
        if (created === worker) fallBackToMainThread()
    })
    worker = created
    startTimer = setTimeout(() => {
        if (created === worker && !workerReady) fallBackToMainThread()
    }, WORKER_START_TIMEOUT_MS)
    return created
}

function pump(): void {
    while (!active && queue.length > 0) {
        const job = queue.shift()!
        const target = getWorker()
        if (!target) {
            renderOnMainThread(job)
            continue
        }
        active = job
        activeTimer = setTimeout(handleTimeout, RENDER_TIMEOUT_MS)
        target.postMessage({ id: job.id, source: job.source, themeId: job.themeId } satisfies RenderRequest)
    }
}

/** Drops a job that hasn't started. One already running is left to finish, so its picture still lands in the cache. */
function dropIfWaiting(job: Job): void {
    const index = queue.indexOf(job)
    if (index === -1) return
    queue.splice(index, 1)
    if (pending.get(job.requestKey) === job) pending.delete(job.requestKey)
    settle(job, { error: new SupersededRenderError() })
}

/**
 * Renders a diagram for the live preview. Rejects with the parser's error for invalid text, with
 * RENDER_TIMEOUT_MESSAGE when it takes too long, and with SupersededRenderError when a newer text
 * for the same document replaced it before it started (and no other view still wanted it).
 */
export function renderMermaidDiagramAsync(source: string, themeId: AppThemeId, documentKey: string): Promise<string> {
    const requestKey = `${themeId}\0${source}`

    // This document has moved on from any older text still waiting, so it no longer needs those renders.
    for (const job of [...queue]) {
        if (job.requestKey === requestKey) continue
        for (const caller of job.callers) {
            if (caller.documentKey === documentKey) job.callers.delete(caller)
        }
        if (job.callers.size === 0) dropIfWaiting(job)
    }

    const caller: Caller = { documentKey }
    const shared = pending.get(requestKey)
    if (shared) {
        shared.callers.add(caller)
        return shared.promise
    }

    let resolve!: (svg: string) => void
    let reject!: (err: Error) => void
    const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
    })
    const job: Job = { id: nextId++, source, themeId, requestKey, callers: new Set([caller]), promise, resolve, reject }
    // Keep sharing the result until callers have had it, so a second view that asks in the same
    // tick (even when the render ran synchronously on the main thread) reuses it.
    pending.set(requestKey, job)
    const forget = () => {
        if (pending.get(requestKey) === job) pending.delete(requestKey)
    }
    promise.then(forget, forget)
    queue.push(job)
    pump()
    return promise
}
