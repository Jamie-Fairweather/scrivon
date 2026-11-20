import { readDocumentLinks, type DocumentLinks } from '@/lib/markdown/document-links'

export type LinksRequest = { id: number; source: string }
export type LinksResponse = { type: 'links-read'; id: number; links: DocumentLinks }

export type LinksReader = {
    /**
     * The links and anchors in `source` (see documentLinks), read off the UI thread when it can be. Given a `key`
     * (which document the text is), a newer read with the same key that comes in while this one still waits takes
     * its place, and this one is rejected with a LinksReadSuperseded.
     */
    read: (source: string, key?: string) => Promise<DocumentLinks>
    /** Stops the worker. Reads still waiting answer with nothing. */
    dispose: () => void
}

/** Why a read was rejected: a newer text for the same document came in before it was read. */
export class LinksReadSuperseded extends Error {
    constructor() {
        super('A newer text for this document came in before this one was read.')
        this.name = 'LinksReadSuperseded'
    }
}

const NOTHING: DocumentLinks = { links: [], anchors: [] }

type Job = { source: string; key: string | undefined; resolve: (links: DocumentLinks) => void; reject: (error: Error) => void }

/**
 * Reads Markdown documents' links in a Web Worker, so a long file never holds up typing. One read runs at a time;
 * the rest wait and are read in the order they were asked, except that only the newest waiting text of each
 * document (by key) is read, as the outline reader keeps only the newest (outline-reader.ts). If the worker can't
 * start or stops working, the reading carries on on the main thread, the reads it had not answered included.
 */
export function createLinksReader(): LinksReader {
    let worker: Worker | null = null
    let workerUnavailable = false
    let disposed = false
    let nextId = 1
    let active: (Job & { id: number }) | null = null
    let waiting: Job[] = []

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
        if (job) waiting.unshift(job)
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
            created = new Worker(new URL('./links.worker.ts', import.meta.url), { type: 'module' })
        } catch {
            workerUnavailable = true
            return null
        }
        created.addEventListener('message', (event: MessageEvent<LinksResponse>) => {
            if (created !== worker || active?.id !== event.data.id) return
            const job = active
            active = null
            job.resolve(event.data.links)
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
        while (!disposed && !active && waiting.length > 0) {
            const job = waiting.shift()!
            const target = getWorker()
            if (!target) {
                job.resolve(readDocumentLinks(job.source))
                continue
            }
            active = { ...job, id: nextId++ }
            target.postMessage({ id: active.id, source: job.source } satisfies LinksRequest)
        }
    }

    return {
        read(source, key) {
            if (disposed) return Promise.resolve(NOTHING)
            return new Promise<DocumentLinks>((resolve, reject) => {
                if (key !== undefined) {
                    const older = waiting.findIndex((job) => job.key === key)
                    if (older !== -1) waiting.splice(older, 1)[0]!.reject(new LinksReadSuperseded())
                }
                waiting.push({ source, key, resolve, reject })
                pump()
            })
        },
        dispose() {
            disposed = true
            const left = [...(active ? [active] : []), ...waiting]
            active = null
            waiting = []
            stopWorker()
            for (const { resolve } of left) resolve(NOTHING)
        },
    }
}

let shared: LinksReader | null = null

/** The app's one links reader, started the first time it is needed. */
export function getLinksReader(): LinksReader {
    shared ??= createLinksReader()
    return shared
}
