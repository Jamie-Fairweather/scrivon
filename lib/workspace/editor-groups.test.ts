import { describe, expect, it } from 'vitest'
import {
    canMoveTabToOtherGroup,
    focusOtherGroup,
    focusedActiveTabId,
    groupsForSession,
    joinGroups,
    leftGroupWidth,
    leftGroupWidthBounds,
    MIN_GROUP_WIDTH,
    moveTabInGroup,
    moveTabToOtherGroup,
    orderLikeGroups,
    reconcileGroups,
    remapGroupsAfterRename,
    removeFromGroup,
    removeTabs,
    restoreGroups,
    showTab,
    singleGroup,
    splitEditor,
    tabsOnlyInGroup,
    unionTabIds,
    type EditorGroups,
} from '@/lib/workspace/editor-groups'

/** Each group's tabs, with the one it shows in brackets, and a star on the focused group. */
function describeGroups(state: EditorGroups): string[] {
    return state.groups.map((g, i) => `${i === state.focused ? '*' : ''}${g.tabIds.map((id) => (id === g.activeTabId ? `[${id}]` : id)).join(' ')}`)
}

function split(left: string[], leftActive: string, right: string[], rightActive: string, focused = 0): EditorGroups {
    return {
        groups: [
            { id: 'group-1', tabIds: left, activeTabId: leftActive },
            { id: 'group-2', tabIds: right, activeTabId: rightActive },
        ],
        focused,
        ratio: 0.5,
    }
}

describe('Split Editor', () => {
    it('makes a right-hand group with the tab and focuses it', () => {
        const next = splitEditor(singleGroup(['a', 'b'], 'b'), 'b')
        expect(describeGroups(next)).toEqual(['a [b]', '*[b]'])
        expect(next.groups[1]!.id).not.toBe(next.groups[0]!.id)
    })

    it('uses the other group when there are two, and never makes a third', () => {
        const state = split(['a', 'b'], 'a', ['c'], 'c')
        expect(describeGroups(splitEditor(state, 'a'))).toEqual(['[a] b', '*c [a]'])
        // Already there: it switches to it.
        const twice = splitEditor(splitEditor(state, 'a'), 'c')
        expect(twice.groups).toHaveLength(2)
        expect(describeGroups(twice)).toEqual(['*a b [c]', 'c [a]'])
    })
})

describe('Move Tab to Other Group', () => {
    it('moves a tab out of the only group into a new right-hand one', () => {
        const next = moveTabToOtherGroup(singleGroup(['a', 'b', 'c'], 'b'), 'b')
        expect(describeGroups(next)).toEqual(['a [c]', '*[b]'])
    })

    it('does nothing to the only tab of the only group', () => {
        const state = singleGroup(['a'], 'a')
        expect(moveTabToOtherGroup(state, 'a')).toBe(state)
        expect(canMoveTabToOtherGroup(state, 'a')).toBe(false)
        expect(canMoveTabToOtherGroup(singleGroup(['a', 'b'], 'a'), 'a')).toBe(true)
    })

    it('moves a tab across, and closes the group it leaves empty', () => {
        expect(describeGroups(moveTabToOtherGroup(split(['a', 'b'], 'a', ['c'], 'c'), 'a'))).toEqual(['[b]', '*c [a]'])
        const emptied = moveTabToOtherGroup(split(['a', 'b'], 'a', ['c'], 'c', 1), 'c', 1)
        expect(describeGroups(emptied)).toEqual(['*a b [c]'])
    })

    it('shows the tab already in the other group instead of adding it twice', () => {
        expect(describeGroups(moveTabToOtherGroup(split(['a', 'b'], 'a', ['a', 'c'], 'c'), 'a'))).toEqual(['[b]', '*[a] c'])
    })
})

describe('focus and join', () => {
    it('moves the keyboard to the other group, and stays put with one', () => {
        expect(focusOtherGroup(split(['a'], 'a', ['b'], 'b')).focused).toBe(1)
        const one = singleGroup(['a'], 'a')
        expect(focusOtherGroup(one)).toBe(one)
    })

    it('joins into one group with every tab once, showing the focused tab', () => {
        const joined = joinGroups(split(['a', 'b'], 'a', ['b', 'c'], 'c', 1))
        expect(describeGroups(joined)).toEqual(['*a b [c]'])
        expect(joined.groups[0]!.id).toBe('group-1')
    })
})

describe('closing in one group', () => {
    it('shows the next tab, else the one before, and closes a group left empty', () => {
        const state = split(['a', 'b', 'c'], 'b', ['d'], 'd')
        expect(describeGroups(removeFromGroup(state, 0, ['b']))).toEqual(['*a [c]', '[d]'])
        expect(describeGroups(removeFromGroup(state, 0, ['c']))).toEqual(['*a [b]', '[d]'])
        expect(describeGroups(removeFromGroup(state, 0, ['b', 'c']))).toEqual(['*[a]', '[d]'])
        expect(describeGroups(removeFromGroup(state, 0, ['b'], 'a'))).toEqual(['*[a] c', '[d]'])
        // The right group closes: the left one takes the keyboard.
        expect(describeGroups(removeFromGroup({ ...state, focused: 1 }, 1, ['d']))).toEqual(['*a [b] c'])
        // The left group closes: the right one is all that is left, and keeps its id.
        const leftGone = removeFromGroup(state, 0, ['a', 'b', 'c'])
        expect(describeGroups(leftGone)).toEqual(['*[d]'])
        expect(leftGone.groups[0]!.id).toBe('group-2')
    })

    it('keeps the last group open, empty', () => {
        expect(describeGroups(removeFromGroup(singleGroup(['a'], 'a'), 0, ['a']))).toEqual(['*'])
    })

    it('says which tabs close for good: those no other group has', () => {
        const state = split(['a', 'b'], 'a', ['a', 'c'], 'c')
        expect(tabsOnlyInGroup(state, 0, ['a', 'b'])).toEqual(['b'])
        expect(tabsOnlyInGroup(state, 1, ['a', 'c'])).toEqual(['c'])
    })

    it('takes a tab closed for good out of every group', () => {
        expect(describeGroups(removeTabs(split(['a', 'b'], 'a', ['a'], 'a', 1), ['a']))).toEqual(['*[b]'])
    })
})

describe('keeping the groups in step with the open tabs', () => {
    it('drops tabs that closed, adds new ones to the focused group, and returns the same object when nothing changed', () => {
        const state = split(['a', 'b'], 'b', ['c'], 'c', 1)
        expect(reconcileGroups(state, ['a', 'b', 'c'])).toBe(state)
        expect(describeGroups(reconcileGroups(state, ['a', 'b', 'c', 'd']))).toEqual(['a [b]', '*[c] d'])
        expect(describeGroups(reconcileGroups(state, ['a', 'c']))).toEqual(['[a]', '*[c]'])
        expect(describeGroups(reconcileGroups(state, ['a', 'b']))).toEqual(['*a [b]'])
    })

    it('fills an empty group with the tabs open', () => {
        expect(describeGroups(reconcileGroups(singleGroup(), ['a', 'b']))).toEqual(['*a b'])
    })
})

describe('showing a tab', () => {
    it('switches to the group that has the file, else opens it in the focused group', () => {
        const state = split(['a'], 'a', ['b'], 'b')
        expect(describeGroups(showTab(state, 'b'))).toEqual(['[a]', '*[b]'])
        expect(describeGroups(showTab(state, 'c'))).toEqual(['*a [c]', '[b]'])
        // The focused group wins when both have it.
        expect(describeGroups(showTab(split(['a', 'b'], 'a', ['b'], 'b', 0), 'b'))).toEqual(['*a [b]', '[b]'])
        // A group given (a click on its strip) is the one.
        expect(describeGroups(showTab(state, 'b', 0))).toEqual(['*a [b]', '[b]'])
    })
})

describe('moving a tab along its strip', () => {
    it('moves it inside its group only', () => {
        const state = split(['a', 'b', 'c'], 'a', ['a'], 'a')
        expect(describeGroups(moveTabInGroup(state, 0, 'a', 5))).toEqual(['*b c [a]', '[a]'])
        expect(moveTabInGroup(state, 0, 'a', 0)).toBe(state)
    })
})

describe('renaming and deleting files', () => {
    it('follows a renamed file, or a moved folder, in both groups', () => {
        const state = split(['C:\\w\\a.md', 'C:\\w\\docs\\b.md'], 'C:\\w\\a.md', ['C:\\w\\docs\\b.md'], 'C:\\w\\docs\\b.md')
        const renamed = remapGroupsAfterRename(state, 'C:\\w\\a.md', 'C:\\w\\z.md')
        expect(describeGroups(renamed)).toEqual(['*[C:\\w\\z.md] C:\\w\\docs\\b.md', '[C:\\w\\docs\\b.md]'])
        const moved = remapGroupsAfterRename(state, 'C:\\w\\docs', 'C:\\w\\notes')
        expect(moved.groups.map((g) => g.activeTabId)).toEqual(['C:\\w\\a.md', 'C:\\w\\notes\\b.md'])
        expect(remapGroupsAfterRename(state, 'C:\\w\\other.md', 'C:\\w\\x.md')).toBe(state)
    })

    it('closes a deleted file in both groups, and a group it leaves empty', () => {
        const state = split(['a', 'b'], 'b', ['b'], 'b', 1)
        expect(describeGroups(removeTabs(state, ['b']))).toEqual(['*[a]'])
    })
})

describe('the divider', () => {
    it('keeps both groups at least 400px wide, and shrinks both evenly when there is no room', () => {
        expect(leftGroupWidth(0.5, 1200)).toBe(600)
        expect(leftGroupWidth(0.1, 1200)).toBe(MIN_GROUP_WIDTH)
        expect(leftGroupWidth(0.9, 1200)).toBe(800)
        expect(leftGroupWidth(0.9, 700)).toBe(350)
        expect(leftGroupWidthBounds(1200)).toEqual({ min: 400, max: 800 })
        expect(leftGroupWidthBounds(700)).toEqual({ min: 350, max: 350 })
    })
})

describe('the tab session', () => {
    it('keeps the split only while two groups have tabs it remembers', () => {
        const state = split(['C:\\a.md', 'example:x'], 'example:x', ['C:\\b.md'], 'C:\\b.md', 1)
        const remember = (id: string) => !id.startsWith('example:')
        expect(groupsForSession(state, remember)).toEqual({
            groups: [
                { tabIds: ['C:\\a.md'], activeTabId: 'C:\\a.md' },
                { tabIds: ['C:\\b.md'], activeTabId: 'C:\\b.md' },
            ],
            focusedGroup: 1,
            groupRatio: 0.5,
        })
        expect(groupsForSession(singleGroup(['C:\\a.md'], 'C:\\a.md'), remember)).toBeUndefined()
        expect(groupsForSession(split(['example:x'], 'example:x', ['C:\\b.md'], 'C:\\b.md'), remember)).toBeUndefined()
    })

    it('restores both groups, their tabs, the focused group and the divider', () => {
        const restored = restoreGroups(
            {
                groups: [
                    { tabIds: ['C:\\w\\a.md', 'C:\\w\\b.md'], activeTabId: 'C:\\w\\b.md' },
                    { tabIds: ['C:\\w\\a.md'], activeTabId: 'C:\\w\\a.md' },
                ],
                focusedGroup: 1,
                groupRatio: 0.3,
            },
            ['C:\\w\\a.md', 'C:\\w\\b.md'],
            'C:\\w\\a.md'
        )
        expect(describeGroups(restored)).toEqual(['C:\\w\\a.md [C:\\w\\b.md]', '*[C:\\w\\a.md]'])
        expect(restored.ratio).toBe(0.3)
        expect(focusedActiveTabId(restored)).toBe('C:\\w\\a.md')
    })

    it('matches stored ids however the path is written, once per group', () => {
        const restored = restoreGroups(
            {
                groups: [
                    { tabIds: ['c:/docs/a.md', 'C:\\Docs\\A.md'], activeTabId: 'c:/docs/a.md' },
                    { tabIds: ['C:/DOCS/B.MD'], activeTabId: null },
                ],
                focusedGroup: 0,
                groupRatio: 0.5,
            },
            ['C:\\Docs\\A.md', 'C:\\Docs\\B.md'],
            null
        )
        expect(describeGroups(restored)).toEqual(['*[C:\\Docs\\A.md]', '[C:\\Docs\\B.md]'])
    })

    it('leaves out tabs that did not open, and a group left empty, and opens an older session as one group', () => {
        const stored = {
            groups: [
                { tabIds: ['C:\\a.md'], activeTabId: 'C:\\a.md' },
                { tabIds: ['C:\\gone.md'], activeTabId: 'C:\\gone.md' },
            ],
            focusedGroup: 1,
            groupRatio: 0.5,
        }
        expect(describeGroups(restoreGroups(stored, ['C:\\a.md', 'C:\\b.md'], 'C:\\b.md'))).toEqual(['*C:\\a.md [C:\\b.md]'])
        expect(describeGroups(restoreGroups(undefined, ['C:\\a.md', 'C:\\b.md'], 'C:\\b.md'))).toEqual(['*C:\\a.md [C:\\b.md]'])
    })

    it('puts tabs no group names in the focused group', () => {
        const stored = {
            groups: [
                { tabIds: ['a'], activeTabId: 'a' },
                { tabIds: ['b'], activeTabId: 'b' },
            ],
            focusedGroup: 0,
            groupRatio: 0.5,
        }
        expect(describeGroups(restoreGroups(stored, ['a', 'b', 'c'], 'a'))).toEqual(['*[a] c', '[b]'])
    })
})

describe('the flat tab list', () => {
    it('follows the order of the strips, left group first', () => {
        const tabs = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]
        const state = split(['a', 'b'], 'a', ['c'], 'c')
        expect(orderLikeGroups(tabs, state).map((t) => t.id)).toEqual(['a', 'b', 'c'])
        const ordered = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
        expect(orderLikeGroups(ordered, state)).toBe(ordered)
        expect(unionTabIds(split(['a', 'b'], 'a', ['b', 'c'], 'c'))).toEqual(['a', 'b', 'c'])
    })
})
