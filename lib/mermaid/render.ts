import { renderMermaidSVG, THEMES, type RenderOptions } from 'beautiful-mermaid'

export const MERMAID_RENDER_OPTIONS: RenderOptions = {
    ...THEMES['zinc-dark'],
    transparent: true,
}

export function scheduleIdleRender(run: () => void): () => void {
    if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(run, { timeout: 100 })
        return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => clearTimeout(id)
}

export function renderMermaidDiagram(source: string): string {
    return renderMermaidSVG(source, MERMAID_RENDER_OPTIONS)
}
