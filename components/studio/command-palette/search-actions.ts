import { foldText } from '@/components/studio/command-palette/fold-text'
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

const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u

function words(text: string): string[] {
    return foldText(text).split(WORD_SEPARATOR).filter(Boolean)
}

/**
 * True when every typed word starts a word of the command's name, e.g. 'dark th' for
 * 'Switch to Dark Theme'. Stricter than the fuzzy match, so a word typed to find text in
 * files ('todo', 'data') doesn't also pull in unrelated commands.
 */
export function matchesCommandName(action: ActionPaletteItem, query: string): boolean {
    const typed = words(query)
    if (typed.length === 0) return false
    const label = words(action.label)
    return typed.every((word) => label.some((labelWord) => labelWord.startsWith(word)))
}
