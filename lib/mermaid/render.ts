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

export function renderMermaidDiagram(source: string, themeId: AppThemeId): string {
    return stripRemoteFontImports(renderMermaidSVG(source, getMermaidRenderOptions(themeId)))
}

export function renderMermaidDiagramForExport(source: string, themeId: AppThemeId): string {
    return stripRemoteFontImports(renderMermaidSVG(source, getMermaidExportRenderOptions(themeId)))
}
