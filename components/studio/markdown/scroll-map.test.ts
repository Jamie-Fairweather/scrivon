import { describe, expect, it } from 'vitest'
import { matchScroll, scrollPairs } from './scroll-map'

describe('scrollPairs', () => {
    it('runs from both tops to both ends, through each block in order', () => {
        const points = [
            { editor: 100, preview: 300 },
            { editor: 40, preview: 120 },
        ]
        expect(scrollPairs(points, { editor: 500, preview: 2000 })).toEqual([
            { editor: 0, preview: 0 },
            { editor: 40, preview: 120 },
            { editor: 100, preview: 300 },
            { editor: 500, preview: 2000 },
        ])
    })

    it('drops a block that would make either pane go back up, such as footnotes shown at the end', () => {
        const points = [
            { editor: 40, preview: 120 },
            { editor: 200, preview: 600 },
            // A footnote written near the top but shown at the bottom.
            { editor: 60, preview: 900 },
            // A paragraph and the list item it sits in: the same place twice.
            { editor: 200, preview: 600 },
        ]
        expect(scrollPairs(points, { editor: 500, preview: 2000 })).toEqual([
            { editor: 0, preview: 0 },
            { editor: 40, preview: 120 },
            { editor: 200, preview: 600 },
            { editor: 500, preview: 2000 },
        ])
    })

    it('drops blocks at or past the end of either pane, so both ends still meet', () => {
        const points = [
            { editor: 40, preview: 120 },
            { editor: 480, preview: 1900 },
            { editor: 520, preview: 1950 },
            { editor: 300, preview: 2100 },
        ]
        expect(scrollPairs(points, { editor: 500, preview: 2000 })).toEqual([
            { editor: 0, preview: 0 },
            { editor: 40, preview: 120 },
            { editor: 480, preview: 1900 },
            { editor: 500, preview: 2000 },
        ])
    })

    it('has only the top when a pane cannot scroll', () => {
        expect(scrollPairs([{ editor: 40, preview: 120 }], { editor: 0, preview: 2000 })).toEqual([{ editor: 0, preview: 0 }])
        expect(scrollPairs([{ editor: 40, preview: 120 }], { editor: 500, preview: 0 })).toEqual([{ editor: 0, preview: 0 }])
    })
})

describe('matchScroll', () => {
    const pairs = [
        { editor: 0, preview: 0 },
        { editor: 40, preview: 120 },
        { editor: 100, preview: 300 },
        { editor: 500, preview: 2000 },
    ]

    it('gives the matching place exactly at a block', () => {
        expect(matchScroll(pairs, 'editor', 40)).toBe(120)
        expect(matchScroll(pairs, 'preview', 300)).toBe(100)
    })

    it('goes the same share of the way between the blocks on either side', () => {
        expect(matchScroll(pairs, 'editor', 70)).toBe(210)
        expect(matchScroll(pairs, 'preview', 1150)).toBe(300)
    })

    it('meets at both ends', () => {
        expect(matchScroll(pairs, 'editor', 0)).toBe(0)
        expect(matchScroll(pairs, 'editor', 500)).toBe(2000)
        expect(matchScroll(pairs, 'preview', 2000)).toBe(500)
    })

    it('stays inside the other pane when asked for a place outside this one', () => {
        expect(matchScroll(pairs, 'editor', -10)).toBe(0)
        expect(matchScroll(pairs, 'editor', 900)).toBe(2000)
    })

    it('stays at the top when a pane cannot scroll', () => {
        expect(matchScroll([{ editor: 0, preview: 0 }], 'editor', 300)).toBe(0)
    })
})
