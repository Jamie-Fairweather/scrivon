import { describe, expect, it } from 'vitest'
import { matchMermaidBlockIds, type MermaidBlockIdentity } from './markdown-block-ordinals'

function previous(...sources: string[]): MermaidBlockIdentity[] {
    return sources.map((source, index) => ({ id: `old${index}`, source }))
}

function match(before: MermaidBlockIdentity[], sources: string[]): string[] {
    let next = 0
    return matchMermaidBlockIds(before, sources, () => `new${next++}`)
}

describe('matchMermaidBlockIds (B28)', () => {
    it('keeps the id of a block whose text did not change, wherever it moved', () => {
        expect(match(previous('A', 'B'), ['B'])).toEqual(['old1'])
        expect(match(previous('A', 'B'), ['N', 'A', 'B'])).toEqual(['new0', 'old0', 'old1'])
        expect(match(previous('A', 'B'), ['B', 'A'])).toEqual(['old1', 'old0'])
    })

    it('keeps the id of a block being edited, when the number of blocks is the same', () => {
        expect(match(previous('A', 'B', 'C'), ['A', 'B2', 'C'])).toEqual(['old0', 'old1', 'old2'])
    })

    it('takes a changed block next to the start or end as an edit when blocks were added or removed', () => {
        // The first block was edited and a new one added at the end.
        expect(match(previous('A', 'B'), ['A2', 'B', 'N'])).toEqual(['old0', 'old1', 'new0'])
        // A block was added at the top and the last one edited.
        expect(match(previous('A', 'B'), ['N', 'A', 'B2'])).toEqual(['new0', 'old0', 'old1'])
        // Deleting a closing fence runs one block into the next: it is the first one, edited.
        expect(match(previous('A', 'B'), ['A\n```mermaid\nB'])).toEqual(['old0'])
    })

    it('gives a new block an id no block had before, rather than a neighbour’s', () => {
        expect(match(previous('A'), ['N', 'A'])).toEqual(['new0', 'old0'])
        expect(match(previous('A', 'B'), ['A', 'N', 'B'])).toEqual(['old0', 'new0', 'old1'])
        expect(match([], ['A', 'B'])).toEqual(['new0', 'new1'])
    })

    /** Runs one pass per step, each against the one before, as the preview does, and returns every pass's ids. */
    function passes(...steps: string[][]): string[][] {
        let next = 0
        let before: MermaidBlockIdentity[] = []
        return steps.map((sources) => {
            const ids = matchMermaidBlockIds(before, sources, () => `new${next++}`)
            before = sources.map((source, index) => ({ id: ids[index]!, source }))
            return ids
        })
    }

    describe('an opening fence pasted above a diagram (review)', () => {
        const D1 = 'graph TD\n  A --> B'
        const N = 'graph LR\n  X --> Y'
        const swallowed = (own: string) => `${own ? `${own}\n` : ''}\`\`\`mermaid\n${D1}`

        it('never hands the diagram’s id to the new block that swallowed it, so the new one can’t show its picture', () => {
            // The new fence takes in D1's fence and text; then N is written into it and closed in one go.
            expect(passes([D1], [swallowed('')], [N, D1])).toEqual([['new0'], ['new1'], ['new2', 'new3']])
            // Pasted with its text already in it.
            expect(passes([D1], [swallowed(N)], [N, D1])).toEqual([['new0'], ['new1'], ['new1', 'new2']])
        })

        it('keeps one id for the new block while it is written', () => {
            expect(passes([D1], [swallowed('')], [swallowed('g')], [swallowed(N)], [N, D1])).toEqual([
                ['new0'],
                ['new1'],
                ['new1'],
                ['new1'],
                ['new1', 'new2'],
            ])
        })

        it('still takes a block whose closing fence was deleted and put back as the same block', () => {
            expect(passes(['A', 'B'], ['A\n```mermaid\nB'], ['A2\n```mermaid\nB'], ['A2', 'B'])).toEqual([
                ['new0', 'new1'],
                ['new0'],
                ['new0'],
                ['new0', 'new2'],
            ])
        })
    })

    it('matches repeated diagrams one to one', () => {
        expect(match(previous('A', 'A'), ['A'])).toEqual(['old0'])
        expect(match(previous('A'), ['A', 'A'])).toEqual(['old0', 'new0'])
    })

    it('never hands out the same new id twice', () => {
        const first = matchMermaidBlockIds([], ['A'])
        const second = matchMermaidBlockIds([], ['A'])
        expect(first[0]).not.toBe(second[0])
    })
})
