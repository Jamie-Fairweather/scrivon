import { samePath } from '@/lib/tauri/fs'
import { remapPathAfterRename } from '@/lib/workspace/tab-paths'

/**
 * The editor area split into groups: each group is a view of some of the open tabs, with its own tab strip, tab
 * shown, editor and preview. The tabs themselves (their text, unsaved state and saves) stay in one flat list, once
 * per file; a group only holds tab ids. There are one or two groups, side by side, never more.
 */

/** Never more than this many groups, side by side. */
export const MAX_EDITOR_GROUPS = 2
/** The narrowest a group may be, when the window has room for two that wide. */
export const MIN_GROUP_WIDTH = 400
/** The left group's share of the width when the editor is first split. */
export const DEFAULT_GROUP_RATIO = 0.5

export type EditorGroup = {
    /** Stays the same while the group is open, so its editor isn't made again when the group beside it closes. */
    readonly id: string
    /** The group's tabs, in the order its strip shows them. */
    readonly tabIds: readonly string[]
    /** The tab the group shows, or null. */
    readonly activeTabId: string | null
}

export type EditorGroups = {
    /** One or two groups, left first. */
    readonly groups: readonly EditorGroup[]
    /** The group last clicked or typed in, which "the current document" means everywhere else. */
    readonly focused: number
    /** The left group's share of the width, between 0 and 1. */
    readonly ratio: number
}

/** A group as the tab session remembers it. */
export type StoredEditorGroup = { tabIds: string[]; activeTabId: string | null }

/** The split as the tab session remembers it: only while there are two groups. */
export type StoredEditorGroups = {
    groups: StoredEditorGroup[]
    focusedGroup: number
    groupRatio: number
}

export const FIRST_GROUP_ID = 'group-1'

/** One group holding these tabs. */
export function singleGroup(tabIds: readonly string[] = [], activeTabId: string | null = null): EditorGroups {
    return { groups: [{ id: FIRST_GROUP_ID, tabIds: [...tabIds], activeTabId }], focused: 0, ratio: DEFAULT_GROUP_RATIO }
}

export const EMPTY_EDITOR_GROUPS: EditorGroups = singleGroup()

/** An id no group has now. */
export function unusedGroupId(state: EditorGroups): string {
    const used = new Set(state.groups.map((g) => g.id))
    let n = 1
    while (used.has(`group-${n}`)) n += 1
    return `group-${n}`
}

export function focusedGroup(state: EditorGroups): EditorGroup {
    return state.groups[state.focused] ?? state.groups[0]!
}

/** The tab the focused group shows: what "the current document" means. */
export function focusedActiveTabId(state: EditorGroups): string | null {
    return focusedGroup(state).activeTabId
}

/** The other group's index, or null while there is only one. */
export function otherGroupIndex(state: EditorGroups, from: number = state.focused): number | null {
    return state.groups.length < 2 ? null : from === 0 ? 1 : 0
}

/** The groups that have the tab, by index. */
export function groupsWithTab(state: EditorGroups, tabId: string): number[] {
    return state.groups.flatMap((g, i) => (g.tabIds.includes(tabId) ? [i] : []))
}

/** Every tab in the groups once: the left group's, then those only the right group has. */
export function unionTabIds(state: EditorGroups): string[] {
    const ids: string[] = []
    for (const group of state.groups) for (const id of group.tabIds) if (!ids.includes(id)) ids.push(id)
    return ids
}

/** The tab next to `id` in `list` that is still in `kept`: the one after it, else the one before, else null. */
function neighbour(list: readonly string[], id: string, kept: readonly string[]): string | null {
    const index = list.indexOf(id)
    if (index === -1) return kept[0] ?? null
    const after = list.slice(index + 1).find((t) => kept.includes(t))
    const before = list.slice(0, index).findLast((t) => kept.includes(t))
    return after ?? before ?? null
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i])
}

function sameGroups(a: EditorGroups, b: EditorGroups): boolean {
    return (
        a.focused === b.focused &&
        a.ratio === b.ratio &&
        a.groups.length === b.groups.length &&
        a.groups.every((g, i) => {
            const other = b.groups[i]!
            return g.id === other.id && g.activeTabId === other.activeTabId && sameIds(g.tabIds, other.tabIds)
        })
    )
}

/** `next`, or `prev` itself when nothing changed, so React and memos see no change. */
function keep(prev: EditorGroups, next: EditorGroups): EditorGroups {
    return sameGroups(prev, next) ? prev : next
}

/** Drops empty groups (but never the last one) and keeps the focused index on a group that is still there. */
function withoutEmptyGroups(groups: EditorGroup[], focused: number, ratio: number): EditorGroups {
    const focusedId = groups[focused]?.id
    const kept = groups.filter((g) => g.tabIds.length > 0)
    if (kept.length === 0) {
        const survivor = groups[focused] ?? groups[0]
        return { groups: [{ id: survivor?.id ?? FIRST_GROUP_ID, tabIds: [], activeTabId: null }], focused: 0, ratio }
    }
    const index = kept.findIndex((g) => g.id === focusedId)
    // The focused group closed: the one left takes the keyboard.
    return { groups: kept, focused: index === -1 ? 0 : index, ratio }
}

/**
 * Keeps the groups in step with the open tabs: a tab that is no longer open leaves every group (its group then
 * shows the tab next to it), a tab no group has goes at the end of the focused group, and a group left with no
 * tabs closes (the last one stays, empty). Returns `state` itself when nothing changes.
 */
export function reconcileGroups(state: EditorGroups, openTabIds: readonly string[]): EditorGroups {
    const open = new Set(openTabIds)
    const groups = state.groups.map((g): EditorGroup => {
        const tabIds = g.tabIds.filter((id, i) => open.has(id) && g.tabIds.indexOf(id) === i)
        const activeTabId = g.activeTabId !== null && !tabIds.includes(g.activeTabId) ? neighbour(g.tabIds, g.activeTabId, tabIds) : g.activeTabId
        return { id: g.id, tabIds, activeTabId }
    })
    const placed = new Set(groups.flatMap((g) => g.tabIds))
    const orphans = openTabIds.filter((id, i) => !placed.has(id) && openTabIds.indexOf(id) === i)
    const focused = Math.min(Math.max(state.focused, 0), groups.length - 1)
    if (orphans.length > 0) {
        const target = groups[focused]!
        groups[focused] = { ...target, tabIds: [...target.tabIds, ...orphans] }
    }
    return keep(state, withoutEmptyGroups(groups, focused, state.ratio))
}

/** Puts the keyboard in group `index`. */
export function focusGroup(state: EditorGroups, index: number): EditorGroups {
    if (index < 0 || index >= state.groups.length || index === state.focused) return state
    return { ...state, focused: index }
}

/** Shows the tab in group `index` (added at the end if it isn't there) and focuses that group. */
function showInGroup(state: EditorGroups, tabId: string, index: number): EditorGroups {
    const groups = state.groups.map((g, i): EditorGroup => {
        if (i !== index) return g
        return { ...g, tabIds: g.tabIds.includes(tabId) ? g.tabIds : [...g.tabIds, tabId], activeTabId: tabId }
    })
    return keep(state, { ...state, groups, focused: index })
}

/**
 * Shows a tab, and focuses the group it shows in. With `groupIndex`, in that group (a click on its strip). Without,
 * as opening a file does: the focused group when it has the tab, else the other group when that has it, else the
 * focused group, at the end of its strip.
 */
export function showTab(state: EditorGroups, tabId: string, groupIndex?: number): EditorGroups {
    if (groupIndex !== undefined && groupIndex >= 0 && groupIndex < state.groups.length) return showInGroup(state, tabId, groupIndex)
    if (focusedGroup(state).tabIds.includes(tabId)) return showInGroup(state, tabId, state.focused)
    const elsewhere = groupsWithTab(state, tabId)[0]
    return showInGroup(state, tabId, elsewhere ?? state.focused)
}

/**
 * Split Editor: shows the tab in the group other than `from` (the focused one, unless a tab's menu says otherwise)
 * and focuses it. With one group, the other group is made first, to the right. With two, the other one is used, so
 * there are never more than two.
 */
export function splitEditor(state: EditorGroups, tabId: string, from: number = state.focused, newId: string = unusedGroupId(state)): EditorGroups {
    const other = otherGroupIndex(state, from)
    if (other !== null) return showInGroup(state, tabId, other)
    return { ...state, groups: [...state.groups, { id: newId, tabIds: [tabId], activeTabId: tabId }], focused: state.groups.length }
}

/**
 * Takes tabs out of group `index`. When the tab the group shows is one of them, `show` takes its place if the group
 * still has it, else the tab next to it. A group left empty closes, unless it is the only one. The tabs stay open:
 * the caller closes those no other group has.
 */
export function removeFromGroup(state: EditorGroups, index: number, ids: readonly string[], show?: string): EditorGroups {
    const target = state.groups[index]
    if (!target) return state
    const gone = new Set(ids)
    const tabIds = target.tabIds.filter((id) => !gone.has(id))
    let activeTabId = target.activeTabId
    if (activeTabId !== null && gone.has(activeTabId)) {
        activeTabId = show !== undefined && tabIds.includes(show) ? show : neighbour(target.tabIds, activeTabId, tabIds)
    }
    const groups = state.groups.map((g, i) => (i === index ? { ...g, tabIds, activeTabId } : g))
    return keep(state, withoutEmptyGroups(groups, state.focused, state.ratio))
}

/** Takes tabs out of every group, as closing them for good (or deleting their files) does. */
export function removeTabs(state: EditorGroups, ids: readonly string[], show?: string): EditorGroups {
    let next = state
    // From the right, so removing the right group's last tab doesn't move the left group's index.
    for (let i = state.groups.length - 1; i >= 0; i--) next = removeFromGroup(next, i, ids, show)
    return next
}

/** Of these tabs in group `index`, those no other group has: closing them there closes them for good. */
export function tabsOnlyInGroup(state: EditorGroups, index: number, ids: readonly string[]): string[] {
    return ids.filter((id) => state.groups.every((g, i) => i === index || !g.tabIds.includes(id)))
}

/**
 * Move Tab to Other Group: takes the tab out of group `from` and shows it in the other group, which takes the
 * keyboard. With one group, the other group is made to the right first. A group left empty closes. Unchanged when
 * there is nowhere to move it (the only tab of the only group).
 */
export function moveTabToOtherGroup(
    state: EditorGroups,
    tabId: string,
    from: number = state.focused,
    newId: string = unusedGroupId(state)
): EditorGroups {
    const source = state.groups[from]
    if (!source?.tabIds.includes(tabId)) return state
    if (state.groups.length < 2) {
        if (source.tabIds.length < 2) return state
        const left = removeFromGroup(state, from, [tabId])
        return { ...left, groups: [...left.groups, { id: newId, tabIds: [tabId], activeTabId: tabId }], focused: left.groups.length }
    }
    const to = from === 0 ? 1 : 0
    const toId = state.groups[to]!.id
    const shown = showInGroup(state, tabId, to)
    const removed = removeFromGroup(shown, from, [tabId])
    // The other group may now be the only one, at index 0.
    return focusGroup(
        removed,
        Math.max(
            0,
            removed.groups.findIndex((g) => g.id === toId)
        )
    )
}

/** Whether Move Tab to Other Group can move the tab out of group `from`. */
export function canMoveTabToOtherGroup(state: EditorGroups, tabId: string | null, from: number = state.focused): boolean {
    const source = state.groups[from]
    if (tabId === null || !source?.tabIds.includes(tabId)) return false
    return state.groups.length > 1 || source.tabIds.length > 1
}

/** Focus Other Group. Unchanged with one group. */
export function focusOtherGroup(state: EditorGroups): EditorGroups {
    const other = otherGroupIndex(state)
    return other === null ? state : focusGroup(state, other)
}

/** Join Groups: every tab in one group, each once: the left group's, then the right group's. The focused tab stays shown. */
export function joinGroups(state: EditorGroups): EditorGroups {
    if (state.groups.length < 2) return state
    return {
        groups: [{ id: state.groups[0]!.id, tabIds: unionTabIds(state), activeTabId: focusedActiveTabId(state) }],
        focused: 0,
        ratio: state.ratio,
    }
}

/** Moves a tab along group `index`'s strip, to `toIndex` (kept inside it). Unchanged when it stays where it was. */
export function moveTabInGroup(state: EditorGroups, index: number, tabId: string, toIndex: number): EditorGroups {
    const group = state.groups[index]
    if (!group) return state
    const from = group.tabIds.indexOf(tabId)
    if (from === -1) return state
    const target = Math.min(Math.max(toIndex, 0), group.tabIds.length - 1)
    if (target === from) return state
    const tabIds = group.tabIds.slice()
    tabIds.splice(from, 1)
    tabIds.splice(target, 0, tabId)
    return { ...state, groups: state.groups.map((g, i) => (i === index ? { ...g, tabIds } : g)) }
}

/** The groups once `oldPath` is renamed or moved to `newPath`: its tabs, and tabs inside it, follow in every group. */
export function remapGroupsAfterRename(state: EditorGroups, oldPath: string, newPath: string): EditorGroups {
    const remap = (id: string) => remapPathAfterRename(id, oldPath, newPath)
    const groups = state.groups.map((g) => ({
        ...g,
        tabIds: g.tabIds.map(remap),
        activeTabId: g.activeTabId === null ? null : remap(g.activeTabId),
    }))
    return keep(state, { ...state, groups })
}

/** Sets the left group's share of the width, kept between 0 and 1. */
export function setGroupRatio(state: EditorGroups, ratio: number): EditorGroups {
    if (!Number.isFinite(ratio)) return state
    const next = Math.min(1, Math.max(0, ratio))
    return next === state.ratio ? state : { ...state, ratio: next }
}

/**
 * The left group's width in a main area `total` pixels wide: its share, kept so both groups are at least
 * MIN_GROUP_WIDTH wide. When the area is narrower than two of those, both groups shrink evenly.
 */
export function leftGroupWidth(ratio: number, total: number): number {
    if (!(total > 0)) return 0
    if (total < MIN_GROUP_WIDTH * 2) return Math.round(total / 2)
    const share = Number.isFinite(ratio) ? ratio : DEFAULT_GROUP_RATIO
    return Math.round(Math.min(total - MIN_GROUP_WIDTH, Math.max(MIN_GROUP_WIDTH, share * total)))
}

/** The narrowest and widest the left group may be in a main area `total` pixels wide. */
export function leftGroupWidthBounds(total: number): { min: number; max: number } {
    if (total < MIN_GROUP_WIDTH * 2) {
        const half = Math.round(Math.max(0, total) / 2)
        return { min: half, max: half }
    }
    return { min: MIN_GROUP_WIDTH, max: Math.round(total - MIN_GROUP_WIDTH) }
}

/**
 * The split as the tab session keeps it, with only the tabs `remember` says yes to (examples aren't kept). Undefined
 * unless two groups still have tabs, so a session with one group is saved exactly as older versions saved it.
 */
export function groupsForSession(state: EditorGroups, remember: (id: string) => boolean): StoredEditorGroups | undefined {
    const groups = state.groups.map((g) => {
        const tabIds = g.tabIds.filter(remember)
        const active = g.activeTabId !== null && tabIds.includes(g.activeTabId) ? g.activeTabId : (tabIds[0] ?? null)
        return { tabIds, activeTabId: active }
    })
    if (groups.length < 2 || groups.some((g) => g.tabIds.length === 0)) return undefined
    return { groups, focusedGroup: state.focused, groupRatio: state.ratio }
}

/**
 * The groups for a folder's tabs as they reopen. Each stored id is matched to an open tab however its path is
 * written (letter case, slash direction), once per group. Tabs that didn't open are left out, and a group left
 * with none isn't restored. Open tabs no group names go to the focused group. Without a split (an older session,
 * or one group left), one group with every tab, showing `activeTabId`.
 */
export function restoreGroups(stored: StoredEditorGroups | undefined, openTabIds: readonly string[], activeTabId: string | null): EditorGroups {
    const fallback = singleGroup(openTabIds, activeTabId !== null && openTabIds.includes(activeTabId) ? activeTabId : (openTabIds[0] ?? null))
    if (!stored) return fallback
    const match = (id: string) => openTabIds.find((open) => open === id) ?? openTabIds.find((open) => samePath(open, id))
    const groups: EditorGroup[] = []
    let focused = 0
    stored.groups.slice(0, MAX_EDITOR_GROUPS).forEach((g, index) => {
        const tabIds: string[] = []
        for (const id of g.tabIds) {
            const open = match(id)
            if (open !== undefined && !tabIds.includes(open)) tabIds.push(open)
        }
        if (tabIds.length === 0) return
        const active = g.activeTabId !== null ? match(g.activeTabId) : undefined
        if (index === stored.focusedGroup) focused = groups.length
        groups.push({ id: `group-${groups.length + 1}`, tabIds, activeTabId: active !== undefined && tabIds.includes(active) ? active : tabIds[0]! })
    })
    if (groups.length < 2) return fallback
    const ratio = Number.isFinite(stored.groupRatio) && stored.groupRatio > 0 && stored.groupRatio < 1 ? stored.groupRatio : DEFAULT_GROUP_RATIO
    return reconcileGroups({ groups, focused, ratio }, openTabIds)
}

/** The tabs in the order the strips show them: the flat list sorted to match, with any tab no group has kept at the end. */
export function orderLikeGroups<T extends { id: string }>(tabs: readonly T[], state: EditorGroups): readonly T[] {
    const order = unionTabIds(state)
    const position = new Map(order.map((id, i) => [id, i]))
    const sorted = tabs
        .map((tab, i) => ({ tab, key: position.get(tab.id) ?? order.length + i }))
        .sort((a, b) => a.key - b.key)
        .map(({ tab }) => tab)
    return sorted.every((tab, i) => tab === tabs[i]) ? tabs : sorted
}
