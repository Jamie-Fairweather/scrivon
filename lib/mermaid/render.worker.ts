/** Lays diagrams out off the UI thread. Started by lib/mermaid/render-client.ts. */
import { checkWorkerCanRender, handleRenderRequest, type RenderRequest, type RenderResponse } from '@/lib/mermaid/render-worker-core'

type WorkerScope = {
    addEventListener(type: 'message', listener: (event: MessageEvent<RenderRequest>) => void): void
    postMessage(message: RenderResponse): void
}

const scope = globalThis as unknown as WorkerScope
const status = checkWorkerCanRender()

if (status.type === 'ready') {
    scope.addEventListener('message', (event) => scope.postMessage(handleRenderRequest(event.data)))
}
scope.postMessage(status)
