import { renderMermaidDiagram } from '@/lib/mermaid/render'
import type { AppThemeId } from '@/lib/theme/catalog'

export type RenderRequest = { id: number; source: string; themeId: AppThemeId }

export type RenderResponse =
    | { type: 'ready' }
    | { type: 'unavailable'; message: string }
    | { type: 'rendered'; id: number; svg: string }
    | { type: 'failed'; id: number; message: string }

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/**
 * Renders inside the diagram worker. ELK, the layout engine inside beautiful-mermaid, checks for
 * `document` the first time it starts. In a worker there is none, so it decides it is a worker of
 * its own, takes over the worker's messages, and never sets up the in-process engine that
 * beautiful-mermaid calls directly, so every render fails. A stand-in `document` while rendering
 * makes it start in-process, exactly as it does on the main thread.
 */
export function renderInWorker(source: string, themeId: AppThemeId): string {
    const scope = globalThis as { document?: unknown }
    const stubbed = scope.document === undefined
    if (stubbed) scope.document = {}
    try {
        return renderMermaidDiagram(source, themeId)
    } finally {
        if (stubbed) delete scope.document
    }
}

export function handleRenderRequest(request: RenderRequest): RenderResponse {
    try {
        return { type: 'rendered', id: request.id, svg: renderInWorker(request.source, request.themeId) }
    } catch (err) {
        return { type: 'failed', id: request.id, message: errorText(err) }
    }
}

/** Draws a tiny diagram so a worker that can't render tells the app to fall back, instead of failing every diagram. */
export function checkWorkerCanRender(): RenderResponse {
    try {
        renderInWorker('graph TD\n  A --> B', 'scrivon-light')
        return { type: 'ready' }
    } catch (err) {
        return { type: 'unavailable', message: errorText(err) }
    }
}
