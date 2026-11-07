import type { Element, ElementContent } from 'hast'
import { describe, expect, it } from 'vitest'
import { blockDirection, isRtl } from '@/lib/markdown/text-direction'

function element(tagName: string, children: ElementContent[], properties: Element['properties'] = {}): Element {
    return { type: 'element', tagName, properties, children }
}

function text(value: string): ElementContent {
    return { type: 'text', value }
}

describe('isRtl', () => {
    it('lets the first letter decide, skipping digits and punctuation', () => {
        expect(isRtl('שלום world')).toBe(true)
        expect(isRtl('1. «مرحبا»')).toBe(true)
        expect(isRtl('Hello שלום')).toBe(false)
        expect(isRtl('123 —')).toBe(false)
        expect(isRtl('')).toBe(false)
    })
})

describe('blockDirection', () => {
    it('reads the first letter inside child paragraphs, which dir="auto" skips', () => {
        const quote = element('blockquote', [text('\n'), element('p', [text('ציטוט')], { dir: 'auto' })])
        expect(blockDirection(quote)).toBe('rtl')
        expect(blockDirection(element('li', [element('p', [element('strong', [text('Note')]), text(' שלום')])]))).toBe('auto')
    })

    it('leaves out code blocks and the ignored texts', () => {
        const item = element('li', [element('pre', [element('code', [text('const a = 1')])]), element('p', [text('مرحبا')])])
        expect(blockDirection(item)).toBe('rtl')
        const placeholder = '__BLOCK_0__'
        const withPlaceholder = element('li', [element('p', [text(placeholder)]), element('p', [text('שלום')])])
        expect(blockDirection(withPlaceholder)).toBe('auto')
        expect(blockDirection(withPlaceholder, new Set([placeholder]))).toBe('rtl')
    })

    it('stays auto when there are no letters', () => {
        expect(blockDirection(element('li', [text('42')]))).toBe('auto')
        expect(blockDirection(element('blockquote', []))).toBe('auto')
    })
})
