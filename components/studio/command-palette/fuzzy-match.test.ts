import { describe, expect, it } from 'vitest'
import { fuzzyRank, fuzzyScore } from '@/components/studio/command-palette/fuzzy-match'

describe('fuzzyScore', () => {
    it('returns 0 for empty query', () => {
        expect(fuzzyScore('docs/readme.md', '')).toBe(0)
    })

    it('matches case-insensitively', () => {
        expect(fuzzyScore('README.md', 'readme')).not.toBeNull()
    })

    it('returns null when characters are missing', () => {
        expect(fuzzyScore('readme.md', 'zzzzz')).toBeNull()
    })

    it('prefers basename matches', () => {
        const basename = fuzzyScore('readme.md', 'readme') ?? 0
        const path = fuzzyScore('docs/arch/readme.md', 'readme') ?? 0
        expect(basename).toBeGreaterThan(path)
    })

    it('boosts matches after path separators', () => {
        const slash = fuzzyScore('docs/readme.md', 'readme') ?? 0
        const backslash = fuzzyScore(String.raw`docs\readme.md`, 'readme') ?? 0
        expect(slash).toBeGreaterThan(fuzzyScore('docsxreadme.md', 'readme') ?? 0)
        expect(backslash).toBeGreaterThan(fuzzyScore('docsxreadme.md', 'readme') ?? 0)
    })

    it('resets consecutive scoring after non-matching characters', () => {
        expect(fuzzyScore('r z r', 'rr')).not.toBeNull()
    })

    it('skips unrelated characters while matching', () => {
        expect(fuzzyScore('axxxb', 'ab')).not.toBeNull()
    })

    it('boosts consecutive character matches', () => {
        const consecutive = fuzzyScore('abc', 'abc') ?? 0
        const sparse = fuzzyScore('a-b-c', 'abc') ?? 0
        expect(consecutive).toBeGreaterThan(sparse)
    })

    it('scores matches at the start of the string', () => {
        expect(fuzzyScore('readme.md', 'r')).not.toBeNull()
    })
})

describe('fuzzyRank', () => {
    it('returns all items when query is empty', () => {
        const ranked = fuzzyRank(['a.md', 'b.md'], '', (item) => item)
        expect(ranked).toHaveLength(2)
    })

    it('handles empty input', () => {
        expect(fuzzyRank([], '', (item) => item)).toEqual([])
        expect(fuzzyRank([], 'readme', (item) => item)).toEqual([])
    })

    it('sorts better matches first', () => {
        const ranked = fuzzyRank(['auth/oauth.md', 'docs/readme.md'], 'readme', (item) => item)
        expect(ranked[0]?.item).toBe('docs/readme.md')
    })

    it('drops items that do not match', () => {
        const ranked = fuzzyRank(['readme.md', 'notes.txt'], 'readme', (item) => item)
        expect(ranked).toHaveLength(1)
    })

    it('orders multiple matching items by score', () => {
        const ranked = fuzzyRank(['readme.md', 'read.me.md', 'other.md'], 'readme', (item) => item)
        expect(ranked.map((entry) => entry.item)).toEqual(['readme.md', 'read.me.md'])
    })
})
