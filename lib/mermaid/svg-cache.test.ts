import { beforeEach, describe, expect, it } from 'vitest'
import {
    clearSvgCache,
    forgetDocumentSvgs,
    hasRenderedInTheme,
    pruneSvgCache,
    readCachedSvg,
    readLatestSvg,
    readRenderError,
    storeRenderError,
    storeSvg,
} from '@/lib/mermaid/svg-cache'

const THEME = 'scrivon-light'

beforeEach(() => {
    clearSvgCache()
})

describe('svg cache', () => {
    it('finds a render by theme, document and source', () => {
        storeSvg(THEME, 'a.mmd', 'graph TD', '<svg>1</svg>')

        expect(readCachedSvg(THEME, 'a.mmd', 'graph TD')).toBe('<svg>1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'graph LR')).toBeNull()
        expect(readCachedSvg('scrivon-dark', 'a.mmd', 'graph TD')).toBeNull()
        expect(readCachedSvg(THEME, 'b.mmd', 'graph TD')).toBeNull()
    })

    it('falls back to the newest render of a document, not the oldest', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg>1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg>2</svg>')
        storeSvg(THEME, 'a.mmd', 'v3', '<svg>3</svg>')

        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg>3</svg>')
    })

    it('prefers a render in this theme, and falls back to another theme rather than nothing (U38)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg>light 1</svg>')
        expect(readLatestSvg('scrivon-dark', 'a.mmd')).toBe('<svg>light 1</svg>')

        storeSvg('scrivon-dark', 'a.mmd', 'v1', '<svg>dark 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg>light 2</svg>')
        expect(readLatestSvg('scrivon-dark', 'a.mmd')).toBe('<svg>dark 1</svg>')
        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg>light 2</svg>')
        expect(readLatestSvg(THEME, 'b.mmd')).toBeNull()
    })

    it('knows whether a document already rendered or failed in a theme (U38)', () => {
        expect(hasRenderedInTheme(THEME, 'a.mmd')).toBe(false)
        storeSvg(THEME, 'a.mmd', 'v1', '<svg/>')
        expect(hasRenderedInTheme(THEME, 'a.mmd')).toBe(true)
        expect(hasRenderedInTheme('scrivon-dark', 'a.mmd')).toBe(false)

        storeRenderError(THEME, 'b.mmd', 'graph', 'Bad header')
        expect(hasRenderedInTheme(THEME, 'b.mmd')).toBe(true)
    })

    it('treats re-rendering an older source as the newest render', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg>1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg>2</svg>')
        storeSvg(THEME, 'a.mmd', 'v1', '<svg>1</svg>')

        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg>1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v2')).toBe('<svg>2</svg>')
    })

    it('keeps only the last few renders of each document', () => {
        for (let i = 1; i <= 50; i++) storeSvg(THEME, 'a.mmd', `v${i}`, `<svg>${i}</svg>`)

        expect(readCachedSvg(THEME, 'a.mmd', 'v50')).toBe('<svg>50</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v49')).toBe('<svg>49</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v1')).toBeNull()
        expect(readCachedSvg(THEME, 'a.mmd', 'v45')).toBeNull()
    })

    it('drops the least recently rendered documents once there are too many', () => {
        storeSvg(THEME, 'first.mmd', 'v', '<svg>first</svg>')
        storeSvg(THEME, 'kept.mmd', 'v', '<svg>kept</svg>')
        for (let i = 0; i < 98; i++) storeSvg(THEME, `doc-${i}.mmd`, 'v', '<svg/>')
        storeSvg(THEME, 'kept.mmd', 'v2', '<svg>kept 2</svg>')

        storeSvg(THEME, 'one-more.mmd', 'v', '<svg/>')

        expect(readLatestSvg(THEME, 'first.mmd')).toBeNull()
        expect(readLatestSvg(THEME, 'kept.mmd')).toBe('<svg>kept 2</svg>')
        expect(readLatestSvg(THEME, 'one-more.mmd')).toBe('<svg/>')
    })

    it('remembers the last failed text of each document', () => {
        storeRenderError(THEME, 'a.mmd', 'bad 1', 'Parse error 1')
        storeRenderError(THEME, 'a.mmd', 'bad 2', 'Parse error 2')

        expect(readRenderError(THEME, 'a.mmd', 'bad 2')).toBe('Parse error 2')
        expect(readRenderError(THEME, 'a.mmd', 'bad 1')).toBeNull()
        expect(readRenderError('scrivon-dark', 'a.mmd', 'bad 2')).toBeNull()
        expect(readRenderError(THEME, 'b.mmd', 'bad 2')).toBeNull()

        clearSvgCache()
        expect(readRenderError(THEME, 'a.mmd', 'bad 2')).toBeNull()
    })

    it('forgets one document', () => {
        storeSvg(THEME, 'a.mmd', 'v', '<svg>a</svg>')
        storeRenderError(THEME, 'a.mmd', 'bad', 'Parse error')
        storeSvg(THEME, 'b.mmd', 'v', '<svg>b</svg>')

        forgetDocumentSvgs('a.mmd')

        expect(readLatestSvg(THEME, 'a.mmd')).toBeNull()
        expect(readRenderError(THEME, 'a.mmd', 'bad')).toBeNull()
        expect(readLatestSvg(THEME, 'b.mmd')).toBe('<svg>b</svg>')
    })

    it('prunes documents and blocks whose tab is closed', () => {
        storeSvg(THEME, 'C:\\docs\\open.mmd', 'v', '<svg>open</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid', 'v', '<svg>block</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid', 'v', '<svg>expanded</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.mmd', 'v', '<svg>closed</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid', 'v', '<svg>closed block</svg>')

        pruneSvgCache(['C:\\docs\\open.mmd', 'C:\\docs\\notes.md'])

        expect(readLatestSvg(THEME, 'C:\\docs\\open.mmd')).toBe('<svg>open</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid')).toBe('<svg>block</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid')).toBe('<svg>expanded</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.mmd')).toBeNull()
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid')).toBeNull()
    })
})
