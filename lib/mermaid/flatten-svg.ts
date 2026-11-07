import { hexColorMix, parseHexColor } from '@/lib/theme/color-mix'

/**
 * beautiful-mermaid writes every colour as `var(--_name)`, works the values out with `color-mix()`
 * in an embedded <style>, and loads Inter with a Google Fonts `@import`. Browsers handle that, but
 * Office, Inkscape, Figma import and librsvg-based converters don't, and draw the diagram as black
 * boxes. This turns the SVG into a self-contained file with plain hex colours, no custom properties,
 * no network font, and a solid background rect (many tools ignore CSS background on <svg>).
 */

type Vars = Map<string, string>

const MAX_DEPTH = 16
const CALL_PATTERN_SOURCE = String.raw`\b(var|color-mix)\(`
const COLOR_ATTRIBUTE_PATTERN = /(\s)(fill|stroke|stop-color|flood-color|color)="([^"]*)"/g
const STYLE_ATTRIBUTE_PATTERN = /(\s)style="([^"]*)"/g
const STYLE_BLOCK_PATTERN = /<style>([\s\S]*?)<\/style>/g
const CUSTOM_PROPERTY_PATTERN = /(--[\w-]+)\s*:\s*([^;{}]+);/g

/** Index of the `)` that closes the `(` at `open`, or -1. */
function findClosingParen(text: string, open: number): number {
    let depth = 0
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++
        else if (text[i] === ')') {
            depth--
            if (depth === 0) return i
        }
    }
    return -1
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(text: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '(') depth++
        else if (ch === ')') depth--
        else if (ch === ',' && depth === 0) {
            parts.push(text.slice(start, i))
            start = i + 1
        }
    }
    parts.push(text.slice(start))
    return parts
}

function resolveVar(inner: string, vars: Vars, depth: number): string | null {
    const [name, ...fallback] = splitTopLevel(inner)
    const value = vars.get(name.trim())
    if (value !== undefined) return resolveValue(value, vars, depth + 1)
    if (fallback.length > 0) return resolveValue(fallback.join(',').trim(), vars, depth + 1)
    return null
}

function parseMixStop(text: string): { color: string; percent: number | null } | null {
    const match = /^(?:(\d+(?:\.\d+)?)%\s+)?(#[\da-f]{6})(?:\s+(\d+(?:\.\d+)?)%)?$/i.exec(text.trim())
    if (!match) return null
    const percent = match[1] ?? match[3]
    return { color: match[2], percent: percent === undefined ? null : Number(percent) }
}

/** Evaluates `color-mix(in srgb, A [p%], B [q%])` for hex colours, like the browser does. */
function evaluateColorMix(inner: string, vars: Vars, depth: number): string | null {
    const parts = splitTopLevel(inner).map((part) => part.trim())
    if (parts.length !== 3 || parts[0].toLowerCase() !== 'in srgb') return null

    const a = parseMixStop(resolveValue(parts[1], vars, depth + 1))
    const b = parseMixStop(resolveValue(parts[2], vars, depth + 1))
    if (!a || !b || !parseHexColor(a.color) || !parseHexColor(b.color)) return null

    const percentA = a.percent ?? (b.percent === null ? 50 : 100 - b.percent)
    const percentB = b.percent ?? 100 - percentA
    const total = percentA + percentB
    if (!(total > 0)) return null

    return hexColorMix(a.color, b.color, (percentA / total) * 100)
}

/** Replaces every var() and color-mix() in a CSS value with what it works out to. Unknown ones are left alone. */
function resolveValue(value: string, vars: Vars, depth = 0): string {
    if (depth > MAX_DEPTH) return value

    const pattern = new RegExp(CALL_PATTERN_SOURCE, 'g')
    let out = ''
    let index = 0
    for (;;) {
        pattern.lastIndex = index
        const match = pattern.exec(value)
        if (!match) break

        const open = match.index + match[0].length - 1
        const close = findClosingParen(value, open)
        if (close < 0) break

        const inner = value.slice(open + 1, close)
        const resolved = match[1] === 'var' ? resolveVar(inner, vars, depth) : evaluateColorMix(inner, vars, depth)
        out += value.slice(index, match.index) + (resolved ?? value.slice(match.index, close + 1))
        index = close + 1
    }
    return out + value.slice(index)
}

function collectVars(svg: string, rootStyle: string): Vars {
    const vars: Vars = new Map()
    for (const [, css] of svg.matchAll(STYLE_BLOCK_PATTERN)) {
        for (const [, name, value] of css.matchAll(CUSTOM_PROPERTY_PATTERN)) vars.set(name, value.trim())
    }
    // Inline style on the root wins over the stylesheet, as in the browser.
    for (const [, name, value] of `${rootStyle};`.matchAll(CUSTOM_PROPERTY_PATTERN)) vars.set(name, value.trim())
    return vars
}

function flattenInlineStyle(style: string, vars: Vars): string {
    return style
        .split(';')
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration && !declaration.startsWith('--'))
        .map((declaration) => resolveValue(declaration, vars))
        .join(';')
}

function flattenCss(css: string, vars: Vars): string {
    const flattened = resolveValue(
        css
            .replace(/@import\s+url\([^)]*\)\s*;?/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/--[\w-]+\s*:[^;{}]*;/g, ''),
        vars
    )
    return flattened
        .replace(/[^{}]*\{\s*\}/g, '')
        .replace(/(font-family:\s*'[^']+'),\s*system-ui/g, "$1, 'Segoe UI', system-ui")
        .replace(/\n\s*(?=\n)/g, '')
}

function backgroundRect(openTag: string, style: string): string {
    const background = /(?:^|;)\s*background(?:-color)?\s*:\s*(#[\da-f]{6})\b/i.exec(style)?.[1]
    const viewBox = /\sviewBox="([^"]+)"/
        .exec(openTag)?.[1]
        .trim()
        .split(/[\s,]+/)
    if (!background || viewBox?.length !== 4) return ''
    const [x, y, width, height] = viewBox
    return `\n<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${background}"/>`
}

export function flattenSvgForExport(svg: string): string {
    const openTagMatch = /<svg\b[^>]*>/.exec(svg)
    if (!openTagMatch) return svg

    const openTag = openTagMatch[0]
    const rootStyle = /\sstyle="([^"]*)"/.exec(openTag)?.[1] ?? ''
    const vars = collectVars(svg, rootStyle)

    const flattenAttributes = (markup: string) =>
        markup
            .replace(COLOR_ATTRIBUTE_PATTERN, (all, space: string, name: string, value: string) =>
                value.includes('(') ? `${space}${name}="${resolveValue(value, vars)}"` : all
            )
            .replace(STYLE_ATTRIBUTE_PATTERN, (_all, space: string, value: string) => {
                const style = flattenInlineStyle(value, vars)
                return style ? `${space}style="${style}"` : ''
            })

    const newOpenTag = flattenAttributes(openTag)
    const newRootStyle = /\sstyle="([^"]*)"/.exec(newOpenTag)?.[1] ?? ''
    const start = openTagMatch.index
    const end = start + openTag.length

    const body = flattenAttributes(svg.slice(end)).replace(STYLE_BLOCK_PATTERN, (_all, css: string) => `<style>${flattenCss(css, vars)}</style>`)

    return svg.slice(0, start) + newOpenTag + backgroundRect(newOpenTag, newRootStyle) + body
}
