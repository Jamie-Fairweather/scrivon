import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** app/globals.css without its comments. */
const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('app/globals.css', () => {
    it('lets the find box tooltips past the clips marked data-find-overflow-host, and only those', () => {
        const rules = [...css.matchAll(/([^{}]+)\{\s*overflow:\s*visible;?\s*\}/g)]
        const selectors = rules.flatMap((rule) => rule[1].split(',').map((selector) => selector.trim()))
        expect(selectors).toEqual(['[data-find-overflow-host]:has(.monaco-editor .find-widget.visible)'])
    })
})
