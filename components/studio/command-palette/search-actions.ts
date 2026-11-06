import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

/**
 * Commands matching the query, best first. With nothing typed, runnable commands come first.
 * While typing, the best match stays on top even when it can't run (its row says why), so
 * Enter never runs a different command than the one typed.
 */
export function searchActions(actions: ActionPaletteItem[], query: string): ActionPaletteItem[] {
    if (!query) return [...actions.filter((action) => !action.disabled), ...actions.filter((action) => action.disabled)]

    const ranked = fuzzyRank(actions, query, (action) => `${action.label} ${action.searchText}`)
    return ranked.map(({ item }) => item)
}
