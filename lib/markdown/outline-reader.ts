import { readOutline, type OutlineHeading } from '@/lib/markdown/document-outline'

export type OutlineRequest = { id: number; source: string }
export type OutlineResponse = { id: number; headings: OutlineHeading[] }

export type OutlineReader = {
    /** Reads the headings of `source`, then calls back with them and `key` (which document they belong to). */
    read: (key: string, source: string) => void
    /** Stops the worker. Nothing is called back after this. */
    dispose: () => void
}

type Job = { key: string; source: string }

/**
 * Reads a Markdown document's headings in a Web Worker, so a long file never holds up typing. One read runs at a
 * time; text that comes in meanwhile waits, and only the newest waiting text is read. If the worker can't start
 * or stops working, the reading carries on on the main thread.
 */
export function createOutlineReader(onRead: (key: string, headings: OutlineHeading[]) => void): OutlineReader {
    let worker: Worker | null = null
    let workerUnavailable = false
    let disposed = false
    let nextId = 1
    let active: (Job & { id: number }) | null = null
    let waiting: Job | null = null

    function stopWorker() {
        worker?.terminate()
        worker = null
    }

    /** The worker can't be used: read what it was reading, and everything after, on the main thread. */
    function fallBackToMainThread() {
        workerUnavailable = true
        stopWorker()
        const job = active
        active = null
        if (job && !waiting) waiting = job
        pump()
    }

    function getWorker(): Worker | null {
        if (worker || workerUnavailable) return worker
        if (typeof Worker === 'undefined') {
            workerUnavailable = true
            return null
        }
        let created: Worker
        try {
            created = new Worker(new URL('./outline.worker.ts', import.meta.url), { type: 'module' })
        } catch {
            workerUnavailable = true
            return null
        }
        created.addEventListener('message', (event: MessageEvent<OutlineResponse>) => {
            if (created !== worker || active?.id !== event.data.id) return
            const job = active
            active = null
            onRead(job.key, event.data.headings)
            pump()
        })
        const fail = () => {
            if (created === worker) fallBackToMainThread()
        }
        created.addEventListener('error', fail)
        created.addEventListener('messageerror', fail)
        worker = created
        return created
    }

    function pump() {
        while (!disposed && !active && waiting) {
            const job = waiting
            waiting = null
            const target = getWorker()
            if (!target) {
                onRead(job.key, readOutline(job.source))
                continue
            }
            active = { ...job, id: nextId++ }
            target.postMessage({ id: active.id, source: job.source } satisfies OutlineRequest)
        }
    }

    return {
        read(key, source) {
            if (disposed) return
            waiting = { key, source }
            pump()
        },
        dispose() {
            disposed = true
            active = null
            waiting = null
            stopWorker()
        },
    }
}
