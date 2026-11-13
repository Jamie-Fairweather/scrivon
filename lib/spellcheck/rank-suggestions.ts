/** How many fixes to offer for one word. */
export const MAX_SUGGESTIONS = 5

/**
 * The most used English words, to pick between fixes that are equally close: `wiht` is far more
 * likely `with` than `whit`.
 */
const COMMON_WORDS = new Set(
    (
        'the of and to in is it you that he was for on are as with his they at be this have from or one had by but not what all ' +
        'were we when your can said there use an each which she do how their if will up other about out many then them these so ' +
        'some her would make like him into time has look two more write go see number no way could people my than first been call ' +
        'who its now find long down day did get come made may part over new after also just only know take year good work back ' +
        'because any where most through well even want here thing give our under name very form great think say help low line before ' +
        'too mean same tell does set three want air play small end put home read hand large add spell land must big high such ' +
        'follow act why ask men change went light kind off need house picture try us again point world near build self earth'
    ).split(' ')
)

/** Swapped neighbours (teh, wiht) are the commonest slip, so they cost less than other changes. */
const SWAP_COST = 0.5
/** A fix in another case than the word was typed in (Ted or NEH for teh) is less likely. */
const CASE_COST = 0.75
const COMMON_BONUS = 0.25

/** Edit distance with swapped neighbours as one cheap step (optimal string alignment). */
function distance(a: string, b: string): number {
    const rows: number[][] = []
    for (let i = 0; i <= a.length; i++) {
        rows[i] = [i]
        for (let j = 1; j <= b.length; j++) {
            if (i === 0) {
                rows[i]![j] = j
                continue
            }
            const same = a[i - 1] === b[j - 1]
            let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (same ? 0 : 1))
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + SWAP_COST)
            rows[i]![j] = best
        }
    }
    return rows[a.length]![b.length]!
}

/** Capitals where the typed word has none: Ted for teh, or THE for The. */
function changesCase(typed: string, fix: string): boolean {
    if (typed === typed.toUpperCase()) return false
    const capitalsAllowed = typed[0] === typed[0]!.toUpperCase() ? 1 : 0
    return /\p{Lu}/u.test(fix.slice(capitalsAllowed))
}

/** The dictionary's fixes for a word, likeliest first, at most {@link MAX_SUGGESTIONS}. */
export function rankSuggestions(typed: string, fixes: readonly string[]): string[] {
    const lower = typed.toLowerCase()
    const score = (fix: string) =>
        distance(lower, fix.toLowerCase()) + (changesCase(typed, fix) ? CASE_COST : 0) - (COMMON_WORDS.has(fix.toLowerCase()) ? COMMON_BONUS : 0)
    return fixes
        .map((fix, index) => ({ fix, index, score: score(fix) }))
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .slice(0, MAX_SUGGESTIONS)
        .map(({ fix }) => fix)
}
