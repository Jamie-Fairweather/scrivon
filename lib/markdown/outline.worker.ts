/** Reads documents' headings off the UI thread. Started by lib/markdown/outline-reader.ts. */
import { readOutline } from '@/lib/markdown/document-outline'
import type { OutlineRequest, OutlineResponse } from '@/lib/markdown/outline-reader'

type WorkerScope = {
    addEventListener(type: 'message', listener: (event: MessageEvent<OutlineRequest>) => void): void
    postMessage(message: OutlineResponse): void
}

const scope = globalThis as unknown as WorkerScope

scope.addEventListener('message', (event) => scope.postMessage({ id: event.data.id, headings: readOutline(event.data.source) }))
