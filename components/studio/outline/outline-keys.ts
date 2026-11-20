/**
 * Where a key moves focus in one of the Outline panel's lists of `count` entries, from `at`: the arrow keys one step,
 * Home and End to the ends. Null for keys the lists don't use. The headings and "Linked from" share it.
 */
export function outlineKeyTarget(key: string, at: number, count: number): number | null {
    if (key === 'ArrowDown') return Math.min(at + 1, count - 1)
    if (key === 'ArrowUp') return Math.max(at - 1, 0)
    if (key === 'Home') return 0
    if (key === 'End') return count - 1
    return null
}
