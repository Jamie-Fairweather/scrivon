import { DIAGRAM_FONT_FAMILY } from '@/lib/mermaid/official-theme'

/**
 * Tidies the SVG the official `mermaid` package draws (see render-official.ts) so it sizes and exports like
 * beautiful-mermaid's.
 */

const OPEN_TAG = /<svg\b[^>]*>/
const VIEW_BOX = /\sviewBox="([^"]*)"/
const SIZE_ATTRIBUTE = /\s(?:width|height)="[^"]*"/g
const STYLE_ATTRIBUTE = /\sstyle="([^"]*)"/
const ID_ATTRIBUTE = /(\sid=")([^"]+)(")/g
/** Where one element points at another: `url(#x)` in an attribute or CSS, and `href="#x"`. */
const ID_REFERENCE = /(url\(\s*['"]?#)([^)'"\s]+)|((?:xlink:)?href="#)([^"]+)/g

function viewBoxSize(openTag: string): { width: number; height: number } | null {
    const parts = VIEW_BOX.exec(openTag)?.[1]
        ?.trim()
        .split(/[\s,]+/)
        .map(Number)
    if (parts?.length !== 4 || !(parts[2]! > 0) || !(parts[3]! > 0)) return null
    return { width: parts[2]!, height: parts[3]! }
}

/** The root's style without `max-width` (Mermaid's `useMaxWidth`), plus a background when there is one. */
function rootStyle(style: string, background: string | null): string {
    const kept = style
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration && !/^(?:max-width|background(?:-color)?)\s*:/i.test(declaration))
    if (background) kept.push(`background-color: ${background}`)
    return kept.join('; ')
}

/**
 * Gives every `id` inside the picture the root's id as a prefix, and points the references at the new names. Mermaid
 * already does this for most of what it draws, but not all (a Sankey diagram's gradients, say), and two diagrams on
 * one page (an HTML or PDF export) must not share an id: a reference would find the other diagram's element.
 */
function scopeIds(svg: string, rootId: string): string {
    const renamed = new Map<string, string>()
    const withIds = svg.replace(ID_ATTRIBUTE, (all, start: string, id: string, end: string) => {
        if (id === rootId || id.startsWith(`${rootId}-`) || id.startsWith(`${rootId}_`)) return all
        const scoped = `${rootId}-${id}`
        renamed.set(id, scoped)
        return `${start}${scoped}${end}`
    })
    if (renamed.size === 0) return withIds
    return withIds.replace(ID_REFERENCE, (all, urlStart?: string, urlId?: string, hrefStart?: string, hrefId?: string) => {
        if (urlStart !== undefined) {
            const scoped = renamed.get(urlId!)
            return scoped ? `${urlStart}${scoped}` : all
        }
        const scoped = renamed.get(hrefId!)
        return scoped ? `${hrefStart}${scoped}` : all
    })
}

export type NormaliseOptions = {
    /** The id the root `<svg>` was drawn with. */
    id: string
    /** A backdrop colour, for an export with a background. Null for none. */
    background: string | null
}

/**
 * Mermaid's SVG, sized and self-contained like beautiful-mermaid's:
 * - Numeric `width` and `height` equal to the viewBox, in place of Mermaid's `width="100%"` and inline `max-width`.
 *   The inline style would beat the preview frame's `svg{max-width:none}`, and the canvas frame, zoom to fit and the
 *   Word export all size the picture from it (getSvgDimensions).
 * - A `background-color` on the root when asked for, which flattenSvgForExport turns into a backdrop rectangle.
 * - Mermaid's font variable written out, so no `var(` is left once an export is flattened.
 * - Every id scoped to the root's own (see scopeIds).
 */
export function normaliseOfficialSvg(svg: string, { id, background }: NormaliseOptions): string {
    const openMatch = OPEN_TAG.exec(svg)
    if (!openMatch) return svg
    const openTag = openMatch[0]
    const size = viewBoxSize(openTag)

    let tag = openTag
    if (size) tag = tag.replace(SIZE_ATTRIBUTE, '').replace(/^<svg\b/, `<svg width="${size.width}" height="${size.height}"`)
    const style = rootStyle(STYLE_ATTRIBUTE.exec(tag)?.[1] ?? '', background)
    tag = tag.replace(STYLE_ATTRIBUTE, '')
    if (style) tag = tag.replace(/(\/?>)$/, ` style="${style}"$1`)

    const rest = svg.slice(openMatch.index + openTag.length).replace(/var\(--mermaid-font-family\)/g, DIAGRAM_FONT_FAMILY)
    return scopeIds(svg.slice(0, openMatch.index) + tag + rest, id)
}

/**
 * An HTML label (`<foreignObject>`): the app's own browser draws it, but a picture drawn from the SVG on a canvas
 * (PNG, copy as PNG, Word) can't, as it taints the canvas.
 */
export function hasForeignObject(svg: string): boolean {
    return /<foreignObject\b/i.test(svg)
}
