import { foldText } from '@/components/studio/command-palette/fold-text'
import { fuzzyRank } from '@/components/studio/command-palette/fuzzy-match'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

/**
 * An on/off command is named after what it switches ('Explorer'), so it also answers to the words
 * for what picking it does now: 'hide explorer' finds Explorer while it shows, 'show explorer' only
 * while it's hidden.
 */
const TURN_OFF_WORDS = 'toggle hide disable turn off'
const TURN_ON_WORDS = 'toggle show enable turn on'

/** The command's name, plus the on/off words for an on/off command. */
function nameOf(action: ActionPaletteItem): string {
    if (action.checked === undefined) return action.label
    return `${action.label} ${action.checked ? TURN_OFF_WORDS : TURN_ON_WORDS}`
}

/** A row that picks a theme ('Theme: Nord', 'Theme: Follow Windows'). */
export function isThemePick(action: ActionPaletteItem): boolean {
    return action.value.startsWith('action:theme:')
}

/**
 * Commands matching the query, best first. With nothing typed, runnable commands come first.
 * While typing, the best match stays on top even when it can't run (its row says why), so
 * Enter never runs a different command than the one typed.
 */
export function searchActions(actions: ActionPaletteItem[], query: string): ActionPaletteItem[] {
    if (!query) return [...actions.filter((action) => !action.disabled), ...actions.filter((action) => action.disabled)]

    const ranked = fuzzyRank(actions, query, (action) => `${nameOf(action)} ${action.searchText}`).map(({ item }) => item)
    // The theme picks start with 'Theme', so they outscore 'Switch to Dark Theme' for 'theme' or
    // 'dark theme'. Commands with every typed word in their name go first, so the switch leads.
    const named = new Set(ranked.filter((action) => !isThemePick(action) && matchesCommandName(action, query)))
    return [...named, ...ranked.filter((action) => !named.has(action))]
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
    const name = words(nameOf(action))
    return typed.every((word) => name.some((nameWord) => nameWord.startsWith(word)))
}
