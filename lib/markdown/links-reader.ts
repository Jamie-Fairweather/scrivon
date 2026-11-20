import { readDocumentLinks, type DocumentLinks } from '@/lib/markdown/document-links'

export type LinksRequest = { id: number; source: string }
export type LinksResponse = { type: 'links-read'; id: number; links: DocumentLinks }

export type LinksReader = {
    /** The links and anchors in `source` (see documentLinks), read off the UI thread when it can be. */
    read: (source: string) => Promise<DocumentLinks>
    /** Stops the worker. Reads still waiting answer with nothing. */
    dispose: () => void
}

const NOTHING: DocumentLinks = { links: [], anchors: [] }

/**
 * Reads Markdown documents' links in a Web Worker, so a long file never holds up typing. Reads are answered in the
 * order they were asked. If the worker can't start or stops working, the reading carries on on the main thread, the
 * reads it had not answered included, as the outline reader does (outline-reader.ts).
 */
export function createLinksReader(): LinksReader {
    let worker: Worker | null = null
    let workerUnavailable = false
    let disposed = false
    let nextId = 1
    const pending = new Map<number, { source: string; resolve: (links: DocumentLinks) => void }>()

    function stopWorker() {
        worker?.terminate()
        worker = null
    }

    function readOnMainThread(source: string, resolve: (links: DocumentLinks) => void) {
        resolve(readDocumentLinks(source))
    }

    /** The worker can't be used: read what it was asked, and everything after, on the main thread. */
    function fallBackToMainThread() {
        workerUnavailable = true
        stopWorker()
        const waiting = [...pending.values()]
        pending.clear()
        for (const { source, resolve } of waiting) readOnMainThread(source, resolve)
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
            if (created !== worker) return
            const job = pending.get(event.data.id)
            if (!job) return
            pending.delete(event.data.id)
            job.resolve(event.data.links)
        })
        const fail = () => {
            if (created === worker) fallBackToMainThread()
        }
        created.addEventListener('error', fail)
        created.addEventListener('messageerror', fail)
        worker = created
        return created
    }

    return {
        read(source) {
            if (disposed) return Promise.resolve(NOTHING)
            return new Promise<DocumentLinks>((resolve) => {
                const target = getWorker()
                if (!target) {
                    readOnMainThread(source, resolve)
                    return
                }
                const id = nextId++
                pending.set(id, { source, resolve })
                target.postMessage({ id, source } satisfies LinksRequest)
            })
        },
        dispose() {
            disposed = true
            const waiting = [...pending.values()]
            pending.clear()
            stopWorker()
            for (const { resolve } of waiting) resolve(NOTHING)
        },
    }
}

let shared: LinksReader | null = null

/** The app's one links reader, started the first time it is needed. */
export function getLinksReader(): LinksReader {
    shared ??= createLinksReader()
    return shared
}
