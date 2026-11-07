import { describe, expect, it } from 'vitest'
import { familyName, splitFontStack } from '@/lib/settings/font-stack'

describe('splitFontStack', () => {
    it('splits on commas outside quoted names only', () => {
        expect(splitFontStack('"A, B Mono", Consolas ,monospace')).toEqual(['"A, B Mono"', 'Consolas', 'monospace'])
        expect(splitFontStack(String.raw`"Odd \"Quote, Font\"", serif`)).toEqual([String.raw`"Odd \"Quote, Font\""`, 'serif'])
        expect(splitFontStack("'Single, Quoted', sans-serif")).toEqual(["'Single, Quoted'", 'sans-serif'])
        expect(splitFontStack(' , Arial,, ')).toEqual(['Arial'])
    })
})

describe('familyName', () => {
    it('drops quotes and escapes and collapses spaces in bare names', () => {
        expect(familyName(String.raw`"Odd \"Quote\" Font"`)).toBe('Odd "Quote" Font')
        expect(familyName(String.raw`'It\'s \\ Mono'`)).toBe(String.raw`It's \ Mono`)
        expect(familyName('Times   New Roman')).toBe('Times New Roman')
        // An unclosed quote is not a quoted name, so it is kept as written.
        expect(familyName('"Broken')).toBe('"Broken')
    })
})
