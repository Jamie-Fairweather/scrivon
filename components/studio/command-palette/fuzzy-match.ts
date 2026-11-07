import { foldText } from '@/components/studio/command-palette/fold-text'

/** Scores `needle` as a subsequence of `hay` (both folded), without the length penalty. */
function subsequenceScore(hay: string, needle: string): number | null {
    let score = 0
    let hayIdx = 0
    let consecutive = 0

    for (let i = 0; i < needle.length; i++) {
        const ch = needle[i]
        let found = false

        while (hayIdx < hay.length) {
            if (hay[hayIdx] === ch) {
                score += 10 + consecutive * 5
                if (hayIdx === 0) score += 20
                const prev = hayIdx > 0 ? hay[hayIdx - 1] : ''
                if (prev === '/' || prev === '\\') score += 15
                consecutive++
                hayIdx++
                found = true
                break
            }
            consecutive = 0
            hayIdx++
        }

        if (!found) return null
    }

    return score
}

/** Returns a score when query matches as a subsequence, or null if no match. Higher is better. */
export function fuzzyScore(text: string, query: string): number | null {
    if (!query) return 0

    const hay = foldText(text)
    const score = subsequenceScore(hay, foldText(query))
    if (score === null) return null
    return score - hay.length * 0.05
}

/**
 * Like fuzzyScore, but each space-separated term must match on its own, in any order,
 * so "docs readme" finds "readme.md docs/readme.md".
 */
export function fuzzyScoreTerms(text: string, query: string): number | null {
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (terms.length <= 1) return fuzzyScore(text, terms[0] ?? '')

    const hay = foldText(text)
    let total = 0
    for (const term of terms) {
        const score = subsequenceScore(hay, foldText(term))
        if (score === null) return null
        total += score
    }
    return total - hay.length * 0.05
}

export function fuzzyRank<T>(items: T[], query: string, getSearchText: (item: T) => string): Array<{ item: T; score: number }> {
    if (!query) {
        return items.map((item) => ({ item, score: 0 }))
    }

    const ranked: Array<{ item: T; score: number }> = []
    for (const item of items) {
        const score = fuzzyScoreTerms(getSearchText(item), query)
        if (score !== null) ranked.push({ item, score })
    }

    ranked.sort((a, b) => b.score - a.score)
    return ranked
}
