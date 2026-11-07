import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** app/globals.css without its comments. */
const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The inside of the first `@media <query> { ... }` block, or '' when there is none. */
function mediaBlock(query: string): string {
    const start = css.indexOf(`@media ${query} {`)
    if (start < 0) return ''
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++
        else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
    }
    return ''
}

/** Each selector in `block` with the declarations of its rule, e.g. 'animation: none'. */
function rulesIn(block: string): Map<string, string[]> {
    const rules = new Map<string, string[]>()
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declarations = body!
            .split(';')
            .map((d) => d.trim().replace(/\s*:\s*/, ': '))
            .filter(Boolean)
        for (const selector of selectors!.split(',')) rules.set(selector.trim(), declarations)
    }
    return rules
}

describe('app/globals.css', () => {
    it('lets the find box tooltips past the clips marked data-find-overflow-host, and only those', () => {
        const rules = [...css.matchAll(/([^{}]+)\{\s*overflow:\s*visible;?\s*\}/g)]
        const selectors = rules.flatMap((rule) => rule[1].split(',').map((selector) => selector.trim()))
        expect(selectors).toEqual(['[data-find-overflow-host]:has(.monaco-editor .find-widget.visible)'])
    })

    describe('with reduced motion', () => {
        const rules = rulesIn(mediaBlock('(prefers-reduced-motion: reduce)'))

        it('stops toasts shaking and bouncing when they are updated', () => {
            for (const name of ['error-odd', 'error-even', 'success-odd', 'success-even']) {
                expect(rules.get(`.animate-toast-${name}`), name).toContain('animation: none')
            }
        })

        it('keeps the fades but drops the slides and zooms of toasts, dialogs and other popups', () => {
            expect(rules.get("[data-slot='toast-viewport'] [data-position]")).toContain('transition-property: opacity')
            expect(rules.get("[data-slot$='-popup']")).toContain('transition-property: opacity')
        })

        it('opens accordions and collapsible panels at once', () => {
            for (const slot of ['accordion-panel', 'collapsible-panel']) {
                expect(rules.get(`[data-slot='${slot}']`), slot).toContain('transition: none')
            }
        })

        it('keeps the loading spinners turning', () => {
            const selectors = [...rules.keys()]
            expect(selectors.length).toBeGreaterThan(0)
            expect(selectors.filter((selector) => selector === '*' || selector.includes('animate-spin'))).toEqual([])
        })
    })
})
