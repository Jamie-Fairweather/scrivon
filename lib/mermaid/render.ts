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

const STYLE_BLOCK = /<style>([\s\S]*?)<\/style>/g
const REMOTE_FONT_IMPORT = /[ \t]*@import\s+url\(\s*['"]?https?:\/\/fonts\.(?:googleapis|gstatic)\.com[^)]*\)\s*;?[ \t]*(?:\r?\n)?/g

/**
 * beautiful-mermaid puts `@import url('https://fonts.googleapis.com/...')` in every diagram to load
 * Inter (and JetBrains Mono for class and ER diagrams) from Google. Scrivon is local-first, so drop
 * them: nothing is fetched, and the preview, SVG, PNG, PDF and Word all use the same font stack
 * (Inter when installed, otherwise the system font), online or offline.
 */
export function stripRemoteFontImports(svg: string): string {
    return svg.replace(STYLE_BLOCK, (_all, css: string) => `<style>${css.replace(REMOTE_FONT_IMPORT, '')}</style>`)
}

const SEQUENCE_MESSAGE = /<g class="message"/
const MESSAGE_LABEL_HALO = '  .message text { paint-order: stroke; stroke: var(--bg); stroke-width: 5px; stroke-linejoin: round; }\n'

/**
 * beautiful-mermaid draws sequence lifelines before the message labels and gives the labels no
 * background, so a dashed lifeline runs straight through any label that crosses another actor.
 * A halo in the background colour, painted under the letters, hides the line behind the text.
 */
export function addMessageLabelHalo(svg: string): string {
    if (!SEQUENCE_MESSAGE.test(svg)) return svg
    return svg.replace('</style>', `${MESSAGE_LABEL_HALO}</style>`)
}

export type ExportRenderOptions = {
    /**
     * Give sequence message labels a halo (see addMessageLabelHalo). Default true. Turn it off for
     * a standalone .svg file: apps without SVG 2 `paint-order` (Office, older Illustrator) would
     * paint the halo over the letters and hide them. PNG, PDF and Word are drawn by the app's own
     * browser engine, which supports it.
     */
    labelHalo?: boolean
}

export function renderMermaidDiagram(source: string, themeId: AppThemeId): string {
    return addMessageLabelHalo(stripRemoteFontImports(renderMermaidSVG(source, getMermaidRenderOptions(themeId))))
}

export function renderMermaidDiagramForExport(source: string, themeId: AppThemeId, { labelHalo = true }: ExportRenderOptions = {}): string {
    const svg = stripRemoteFontImports(renderMermaidSVG(source, getMermaidExportRenderOptions(themeId)))
    return labelHalo ? addMessageLabelHalo(svg) : svg
}
