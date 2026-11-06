import { describe, expect, it } from 'vitest'
import { foldLine, foldText, originalSpan } from '@/components/studio/command-palette/fold-text'

describe('foldText', () => {
    it('composes and lower-cases', () => {
        expect(foldText('CAFE\u0301')).toBe('caf\u00e9')
        expect(foldText('한글'.normalize('NFD'))).toBe('한글')
    })
})

describe('foldLine', () => {
    it('keeps positions as they are when folding keeps the length', () => {
        expect(foldLine('Hello World')).toEqual({ folded: 'hello world', starts: null, ends: null })
    })

    it('maps a match in composed text back to the decomposed original', () => {
        const line = 'x cafe\u0301 y'
        const folded = foldLine(line)
        const idx = folded.folded.indexOf('caf\u00e9')
        expect(originalSpan(folded, idx, 4)).toEqual({ start: 2, length: 5 })
        expect(originalSpan(folded, folded.folded.indexOf('y'), 1)).toEqual({ start: line.indexOf('y'), length: 1 })
    })
})
