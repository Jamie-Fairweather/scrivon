import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

export function searchActions(actions: ActionPaletteItem[], query: string): ActionPaletteItem[] {
    if (!query) return actions

    const ranked = fuzzyRank(actions, query, (action) => `${action.label} ${action.searchText}`)
    return ranked.map(({ item }) => item)
}
