/** Returns a score when query matches as a subsequence, or null if no match. Higher is better. */
export function fuzzyScore(text: string, query: string): number | null {
    if (!query) return 0

    const hay = text.toLowerCase()
    const needle = query.toLowerCase()

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

    score -= hay.length * 0.05
    return score
}

export function fuzzyRank<T>(items: T[], query: string, getSearchText: (item: T) => string): Array<{ item: T; score: number }> {
    if (!query) {
        return items.map((item) => ({ item, score: 0 }))
    }

    const ranked: Array<{ item: T; score: number }> = []
    for (const item of items) {
        const score = fuzzyScore(getSearchText(item), query)
        if (score !== null) ranked.push({ item, score })
    }

    ranked.sort((a, b) => b.score - a.score)
    return ranked
}
