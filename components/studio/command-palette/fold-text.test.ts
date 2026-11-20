import { describe, expect, it } from 'vitest'
import { foldLine, foldText, normalizeLine, normalizeText, originalSpan } from '@/components/studio/command-palette/fold-text'

describe('foldText', () => {
    it('composes and lower-cases', () => {
        expect(foldText('CAFE\u0301')).toBe('caf\u00e9')
        expect(foldText('한글'.normalize('NFD'))).toBe('한글')
    })

    it('keeps one letter per letter for Turkish dotted I and Greek sigma', () => {
        expect(foldText('İzmir')).toBe('izmir')
        expect(foldText('ΟΔΟΣ')).toBe(foldText('οδοσ'))
        expect(foldText('οδος')).toBe('οδοσ')
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

describe('normalizeLine', () => {
    it('composes but keeps the case', () => {
        expect(normalizeText('CAFÉ')).toBe('CAFÉ')
        expect(normalizeLine('Hello World')).toEqual({ folded: 'Hello World', starts: null, ends: null })
    })

    it('maps a match in composed text back to the decomposed original, as foldLine does', () => {
        const line = 'x Café Y'
        const normalized = normalizeLine(line)
        expect(normalized.folded).toBe('x Café Y')
        expect(originalSpan(normalized, normalized.folded.indexOf('Café'), 4)).toEqual({ start: 2, length: 5 })
        expect(originalSpan(normalized, normalized.folded.indexOf('Y'), 1)).toEqual({ start: line.indexOf('Y'), length: 1 })
    })
})
