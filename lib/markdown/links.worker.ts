/** Reads documents' links and anchors off the UI thread. Started by lib/markdown/links-reader.ts. */
import { readDocumentLinks } from '@/lib/markdown/document-links'
import type { LinksRequest, LinksResponse } from '@/lib/markdown/links-reader'

type WorkerScope = {
    addEventListener(type: 'message', listener: (event: MessageEvent<LinksRequest>) => void): void
    postMessage(message: LinksResponse): void
}

const scope = globalThis as unknown as WorkerScope

scope.addEventListener('message', (event) => scope.postMessage({ type: 'links-read', id: event.data.id, links: readDocumentLinks(event.data.source) }))
