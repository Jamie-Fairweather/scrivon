import { renderMermaidSVG, type RenderOptions } from 'beautiful-mermaid'
import { getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'

export function getMermaidRenderOptions(themeId: AppThemeId): RenderOptions {
    return {
        ...getDiagramColors(themeId),
        transparent: true,
    }
}

/** Opaque background for standalone SVG/PNG files opened outside the app. */
export function getMermaidExportRenderOptions(themeId: AppThemeId): RenderOptions {
    return {
        ...getDiagramColors(themeId),
        transparent: false,
    }
}

export function scheduleIdleRender(run: () => void): () => void {
    if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(run, { timeout: 100 })
        return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => clearTimeout(id)
}

export function renderMermaidDiagram(source: string, themeId: AppThemeId): string {
    return renderMermaidSVG(source, getMermaidRenderOptions(themeId))
}

export function renderMermaidDiagramForExport(source: string, themeId: AppThemeId): string {
    return renderMermaidSVG(source, getMermaidExportRenderOptions(themeId))
}
