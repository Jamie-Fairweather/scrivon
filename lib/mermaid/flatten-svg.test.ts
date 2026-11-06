import { describe, expect, it } from 'vitest'
import { CRAFT_EXAMPLES, EXAMPLE_CATEGORIES } from '@/lib/examples/craft-samples'
import { buildExportSvg } from '@/lib/mermaid/export'
import { flattenSvgForExport } from '@/lib/mermaid/flatten-svg'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { getDiagramColors } from '@/lib/theme/catalog'
import { hexColorMix } from '@/lib/theme/color-mix'

const LEFTOVERS = /var\(|color-mix|@import|googleapis|--[\w-]+\s*:/

describe('flattenSvgForExport', () => {
    it('bakes theme colours into a flowchart and drops the variable block and font import', () => {
        const raw = renderMermaidDiagramForExport('graph TD\n  A[Start] --> B{Ok?}\n  B --> C[End]', 'scrivon-light')
        expect(raw).toMatch(/var\(--_node-fill\)/)

        const svg = flattenSvgForExport(raw)
        const { bg, fg } = getDiagramColors('scrivon-light')

        expect(svg).not.toMatch(LEFTOVERS)
        expect(svg).toContain(`fill="${hexColorMix(fg, bg, 3)}"`)
        expect(svg).toContain(`stroke="${hexColorMix(fg, bg, 20)}"`)
        expect(svg).toContain(`stroke="${hexColorMix(fg, bg, 50)}"`)
        expect(svg).toContain(`fill="${fg}"`)
        expect(svg).toMatch(/<svg [^>]*style="background:#ffffff"/)
        expect(svg).toMatch(/^<svg [^>]*>\n<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#ffffff"\/>/)
        expect(svg).toContain("font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;")
    })

    it('uses theme overrides such as line and accent instead of the mixed fallback', () => {
        const svg = flattenSvgForExport(renderMermaidDiagramForExport('graph LR\n  A --> B', 'tokyo-night'))
        const { line, accent } = getDiagramColors('tokyo-night')

        expect(svg).not.toMatch(LEFTOVERS)
        expect(svg).toContain(`stroke="${line}"`)
        expect(svg).toContain(`fill="${accent}"`)
    })

    it('resolves xychart class rules, including two-percent color-mix()', () => {
        const svg = flattenSvgForExport(renderMermaidDiagramForExport('xychart-beta\n  x-axis [a, b, c]\n  bar [1, 3, 2]', 'tokyo-night'))
        const { bg, accent } = getDiagramColors('tokyo-night')

        expect(svg).not.toMatch(LEFTOVERS)
        expect(svg).toContain(`.xychart-bar.xychart-color-0 { stroke: ${accent}; fill: ${hexColorMix(bg!, accent!, 75)}; }`)
    })

    it('leaves no CSS variables in any kind of diagram, in light and dark themes', () => {
        for (const category of EXAMPLE_CATEGORIES) {
            const example = CRAFT_EXAMPLES.find((ex) => ex.category === category)!
            for (const themeId of ['scrivon-light', 'scrivon-dark', 'tokyo-night'] as const) {
                const svg = flattenSvgForExport(renderMermaidDiagramForExport(example.source, themeId))
                expect(svg, `${example.id} in ${themeId}`).not.toMatch(LEFTOVERS)
            }
        }
    })

    it('keeps the background transparent when the render had none', () => {
        const svg = flattenSvgForExport(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" style="--fg:#000000"><rect fill="var(--fg)"/></svg>'
        )

        expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="#000000"/></svg>')
    })

    it('leaves values it cannot work out untouched instead of guessing', () => {
        const svg = flattenSvgForExport('<svg viewBox="0 0 1 1"><rect fill="var(--missing)" stroke="color-mix(in oklch, red, blue)"/></svg>')

        expect(svg).toContain('fill="var(--missing)"')
        expect(svg).toContain('stroke="color-mix(in oklch, red, blue)"')
    })

    it('does not touch diagram text that happens to look like CSS', () => {
        const svg = flattenSvgForExport(renderMermaidDiagramForExport('graph TD\n  A["fill=var(--bg)"] --> B', 'scrivon-light'))

        expect(svg).toContain('>fill=var(--bg)</text>')
    })
})

describe('buildExportSvg', () => {
    it('returns the flattened, self-contained SVG', () => {
        const svg = buildExportSvg('  graph TD\n  A --> B  ', 'scrivon-dark')

        expect(svg).not.toMatch(LEFTOVERS)
        expect(svg).toContain(`fill="${getDiagramColors('scrivon-dark').bg}"`)
    })

    it('rejects empty source', () => {
        expect(() => buildExportSvg('   ', 'scrivon-light')).toThrow('Nothing to export.')
    })
})
