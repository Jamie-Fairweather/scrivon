import { describe, expect, it } from 'vitest'
import { flattenSvgForExport } from '@/lib/mermaid/flatten-svg'
import { hasForeignObject, normaliseOfficialSvg } from '@/lib/mermaid/official-svg'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

/** As Mermaid draws a pie chart with `useMaxWidth`, its default. */
const PIE =
    '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" class="pie" style="max-width: 489.5px;" viewBox="-10 -5 489.5 450" ' +
    'role="graphics-document document" aria-roledescription="pie">' +
    '<style>#m1{font-family:var(--mermaid-font-family);}#m1 .pieCircle{fill:#ff0000;}:root{--mermaid-font-family:"trebuchet ms";}</style>' +
    '<g><path class="pieCircle" d="M0 0"/></g></svg>'

describe('normaliseOfficialSvg', () => {
    it("sizes the root from its viewBox in place of Mermaid's 100% width and inline max-width", () => {
        const svg = normaliseOfficialSvg(PIE, { id: 'm1', background: null })
        const root = /<svg\b[^>]*>/.exec(svg)![0]
        expect(root).toContain('width="489.5" height="450"')
        expect(root).not.toContain('100%')
        expect(root).not.toContain('max-width')
        expect(root).not.toContain('style=')
        // Everything else Mermaid put on the root stays.
        expect(root).toContain('id="m1"')
        expect(root).toContain('viewBox="-10 -5 489.5 450"')
        expect(root).toContain('aria-roledescription="pie"')
        expect(getSvgDimensions(svg)).toEqual({ width: 489.5, height: 450 })
    })

    it('puts the background on the root when asked, so a flattened export gets a backdrop rectangle', () => {
        const svg = normaliseOfficialSvg(PIE, { id: 'm1', background: '#1e1e2e' })
        expect(/<svg\b[^>]*>/.exec(svg)![0]).toContain('style="background-color: #1e1e2e"')
        const flat = flattenSvgForExport(svg)
        expect(flat).toContain('<rect x="-10" y="-5" width="489.5" height="450" fill="#1e1e2e"/>')
        expect(flat).not.toContain('var(')
        expect(flat).not.toContain('max-width')
    })

    it('replaces a root background Mermaid set, and keeps its other root styles', () => {
        const svg = normaliseOfficialSvg('<svg id="m2" style="max-width: 10px; background-color: white; opacity: 0.9" viewBox="0 0 10 20"></svg>', {
            id: 'm2',
            background: '#ffffff',
        })
        expect(svg).toBe('<svg width="10" height="20" id="m2" viewBox="0 0 10 20" style="opacity: 0.9; background-color: #ffffff"></svg>')
    })

    it("writes out Mermaid's font variable, so no var( is left once flattened", () => {
        const svg = normaliseOfficialSvg(PIE, { id: 'm1', background: null })
        expect(svg).not.toContain('var(--mermaid-font-family)')
        expect(svg).toContain("font-family:Inter, 'Segoe UI', system-ui, sans-serif;")
        expect(flattenSvgForExport(svg)).not.toContain('var(')
    })

    it("gives every inner id the root's prefix and points references at it, leaving ids Mermaid already prefixed", () => {
        const source =
            '<svg id="m3" viewBox="0 0 10 10"><defs><linearGradient id="linearGradient-1"/><marker id="m3_arrow"/><g id="m3-node"/></defs>' +
            '<path stroke="url(#linearGradient-1)" marker-end="url(#m3_arrow)"/><use href="#linearGradient-1" xlink:href="#linearGradient-1"/>' +
            '<style>#m3 .a{fill:url(#linearGradient-1);}</style></svg>'
        const svg = normaliseOfficialSvg(source, { id: 'm3', background: null })
        expect(svg).toContain('<linearGradient id="m3-linearGradient-1"/>')
        expect(svg).toContain('<marker id="m3_arrow"/>')
        expect(svg).toContain('<g id="m3-node"/>')
        expect(svg).toContain('stroke="url(#m3-linearGradient-1)"')
        expect(svg).toContain('marker-end="url(#m3_arrow)"')
        expect(svg).toContain('<use href="#m3-linearGradient-1" xlink:href="#m3-linearGradient-1"/>')
        expect(svg).toContain('fill:url(#m3-linearGradient-1);')
        expect(svg).not.toMatch(/id="linearGradient-1"/)
    })

    it('leaves a picture without a viewBox at the size Mermaid gave it', () => {
        expect(normaliseOfficialSvg('<svg id="m4" width="30" height="40"></svg>', { id: 'm4', background: null })).toBe(
            '<svg id="m4" width="30" height="40"></svg>'
        )
        expect(normaliseOfficialSvg('not an svg', { id: 'm4', background: null })).toBe('not an svg')
    })
})

describe('hasForeignObject', () => {
    it('finds an HTML label, whatever the case', () => {
        expect(hasForeignObject('<svg><foreignObject><div>x</div></foreignObject></svg>')).toBe(true)
        expect(hasForeignObject('<svg><foreignobject></foreignobject></svg>')).toBe(true)
        expect(hasForeignObject('<svg><text>foreignObject</text></svg>')).toBe(false)
    })
})
