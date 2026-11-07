import { beforeEach, describe, expect, it } from 'vitest'
import {
    clearSvgCache,
    forgetDocumentSvgs,
    isBeingEdited,
    pruneSvgCache,
    readCachedSvg,
    readLatestSvg,
    readRenderError,
    readSvgForSource,
    startRender,
    storeRenderError,
    storeSvg,
    touchSvg,
} from '@/lib/mermaid/svg-cache'

const THEME = 'scrivon-light'
const DARK = 'scrivon-dark'
/** Text that has no render of its own, so readLatestSvg has to fall back. */
const BROKEN = 'graph'

beforeEach(() => {
    clearSvgCache()
})

describe('svg cache', () => {
    it('finds a render by theme, document and source', () => {
        storeSvg(THEME, 'a.mmd', 'graph TD', '<svg viewBox="0 0 10 10">1</svg>')

        expect(readCachedSvg(THEME, 'a.mmd', 'graph TD')).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'graph LR')).toBeNull()
        expect(readCachedSvg(DARK, 'a.mmd', 'graph TD')).toBeNull()
        expect(readCachedSvg(THEME, 'b.mmd', 'graph TD')).toBeNull()
    })

    it('finds the same text drawn in another document, in the same theme only (B28)', () => {
        storeSvg(THEME, 'doc.md:block:doc.md:b1:mermaid', 'graph TD', '<svg viewBox="0 0 10 10">moved</svg>')

        expect(readSvgForSource(THEME, 'graph TD')).toBe('<svg viewBox="0 0 10 10">moved</svg>')
        expect(readSvgForSource(DARK, 'graph TD')).toBeNull()
        expect(readSvgForSource(THEME, 'graph LR')).toBeNull()
    })

    it('falls back to the newest render of a document, not the oldest', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>')
        storeSvg(THEME, 'a.mmd', 'v3', '<svg viewBox="0 0 10 10">3</svg>')

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">3</svg>')
    })

    it('falls back to the version the user went back to, not the one rendered last (B14 review)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>')

        touchSvg(THEME, 'a.mmd', 'v1')

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v2')).toBe('<svg viewBox="0 0 10 10">2</svg>')
    })

    it('keeps a late result behind a version the user went back to after asking for it (B14 review)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        const startedAt = startRender()
        touchSvg(THEME, 'a.mmd', 'v1')

        expect(storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>', startedAt)).toBe(true)

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v2')).toBe('<svg viewBox="0 0 10 10">2</svg>')
    })

    it('puts a late result first when nothing was looked at since it was asked for (P01 review)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        const startedAt = startRender()

        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>', startedAt)

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">2</svg>')
    })

    it('does not keep a render that started before the document was cleared (P01 review)', () => {
        const startedAt = startRender()
        forgetDocumentSvgs('a.mmd')

        expect(storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>', startedAt)).toBe(false)
        expect(storeRenderError(THEME, 'a.mmd', BROKEN, 'Parse error', startedAt)).toBe(false)
        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBeNull()
        expect(readRenderError(THEME, 'a.mmd', BROKEN)).toBeNull()

        expect(storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>', startRender())).toBe(true)
        expect(storeSvg(THEME, 'b.mmd', 'v1', '<svg viewBox="0 0 10 10">b</svg>', startedAt)).toBe(true)
    })

    it('still drops a render from before a clear after many other documents were cleared', () => {
        const startedAt = startRender()
        forgetDocumentSvgs('a.mmd')
        for (let i = 0; i < 150; i++) forgetDocumentSvgs(`doc-${i}.mmd`)

        expect(storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>', startedAt)).toBe(false)
    })

    it('does not keep a render that started before the whole cache was cleared', () => {
        const startedAt = startRender()
        clearSvgCache()

        expect(storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>', startedAt)).toBe(false)
    })

    it('prefers a render in this theme, and falls back to another theme rather than nothing (U38)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">light 1</svg>')
        expect(readLatestSvg(DARK, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">light 1</svg>')

        storeSvg(DARK, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">dark 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">light 2</svg>')
        expect(readLatestSvg(DARK, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">dark 1</svg>')
        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">light 2</svg>')
        expect(readLatestSvg(THEME, 'b.mmd', BROKEN)).toBeNull()
    })

    it('prefers the same text in another theme over an older version in this one (U38 review)', () => {
        storeSvg(DARK, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">dark 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">light 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">light 2</svg>')

        expect(readLatestSvg(DARK, 'a.mmd', 'v2')).toBe('<svg viewBox="0 0 10 10">light 2</svg>')
    })

    it('does not fall back past a render that had nothing to draw (U39)', () => {
        storeSvg(THEME, 'a.mmd', 'graph TD\n  A', '<svg viewBox="0 0 10 10"></svg>')
        storeSvg(THEME, 'a.mmd', 'graph TD', '<svg viewBox="0 0 0 0" width="0" height="0"></svg>')

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBeNull()
        expect(readCachedSvg(THEME, 'a.mmd', 'graph TD')).toBe('<svg viewBox="0 0 0 0" width="0" height="0"></svg>')
    })

    it('treats text as an edit once the document rendered or failed in this theme (U38)', () => {
        expect(isBeingEdited(THEME, 'a.mmd', 'v2')).toBe(false)
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10"/>')
        expect(isBeingEdited(THEME, 'a.mmd', 'v2')).toBe(true)
        expect(isBeingEdited(DARK, 'a.mmd', 'v2')).toBe(false)

        storeRenderError(THEME, 'b.mmd', 'graph', 'Bad header')
        expect(isBeingEdited(THEME, 'b.mmd', 'graph TD')).toBe(true)
    })

    it('does not treat a theme change as an edit, even when this theme has older renders (U38 review)', () => {
        storeSvg(DARK, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">dark 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">light 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">light 2</svg>')
        expect(isBeingEdited(DARK, 'a.mmd', 'v2')).toBe(false)

        storeRenderError(THEME, 'a.mmd', BROKEN, 'Bad header')
        expect(isBeingEdited(DARK, 'a.mmd', BROKEN)).toBe(false)
        expect(isBeingEdited(DARK, 'a.mmd', 'v3')).toBe(true)
    })

    it('treats re-rendering an older source as the newest render', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>')
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v2')).toBe('<svg viewBox="0 0 10 10">2</svg>')
    })

    it('keeps only the last few renders of each document', () => {
        for (let i = 1; i <= 50; i++) storeSvg(THEME, 'a.mmd', `v${i}`, `<svg viewBox="0 0 10 10">${i}</svg>`)

        expect(readCachedSvg(THEME, 'a.mmd', 'v50')).toBe('<svg viewBox="0 0 10 10">50</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v49')).toBe('<svg viewBox="0 0 10 10">49</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v1')).toBeNull()
        expect(readCachedSvg(THEME, 'a.mmd', 'v45')).toBeNull()
    })

    it('drops the least recently used documents once there are too many', () => {
        storeSvg(THEME, 'first.mmd', 'v', '<svg viewBox="0 0 10 10">first</svg>')
        storeSvg(THEME, 'kept.mmd', 'v', '<svg viewBox="0 0 10 10">kept</svg>')
        storeSvg(THEME, 'touched.mmd', 'v', '<svg viewBox="0 0 10 10">touched</svg>')
        for (let i = 0; i < 97; i++) storeSvg(THEME, `doc-${i}.mmd`, 'v', '<svg viewBox="0 0 10 10"/>')
        storeSvg(THEME, 'kept.mmd', 'v2', '<svg viewBox="0 0 10 10">kept 2</svg>')
        touchSvg(THEME, 'touched.mmd', 'v')

        storeSvg(THEME, 'one-more.mmd', 'v', '<svg viewBox="0 0 10 10"/>')

        expect(readLatestSvg(THEME, 'first.mmd', BROKEN)).toBeNull()
        expect(readLatestSvg(THEME, 'kept.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">kept 2</svg>')
        expect(readLatestSvg(THEME, 'touched.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">touched</svg>')
        expect(readLatestSvg(THEME, 'one-more.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10"/>')
    })

    it('remembers the last failed text of each document', () => {
        storeRenderError(THEME, 'a.mmd', 'bad 1', 'Parse error 1')
        storeRenderError(THEME, 'a.mmd', 'bad 2', 'Parse error 2')

        expect(readRenderError(THEME, 'a.mmd', 'bad 2')).toBe('Parse error 2')
        expect(readRenderError(THEME, 'a.mmd', 'bad 1')).toBeNull()
        expect(readRenderError(DARK, 'a.mmd', 'bad 2')).toBeNull()
        expect(readRenderError(THEME, 'b.mmd', 'bad 2')).toBeNull()

        clearSvgCache()
        expect(readRenderError(THEME, 'a.mmd', 'bad 2')).toBeNull()
    })

    it('forgets one document', () => {
        storeSvg(THEME, 'a.mmd', 'v', '<svg viewBox="0 0 10 10">a</svg>')
        storeRenderError(THEME, 'a.mmd', 'bad', 'Parse error')
        storeSvg(THEME, 'b.mmd', 'v', '<svg viewBox="0 0 10 10">b</svg>')

        forgetDocumentSvgs('a.mmd')

        expect(readLatestSvg(THEME, 'a.mmd', BROKEN)).toBeNull()
        expect(readRenderError(THEME, 'a.mmd', 'bad')).toBeNull()
        expect(readLatestSvg(THEME, 'b.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">b</svg>')
    })

    it('prunes documents and blocks whose tab is closed', () => {
        storeSvg(THEME, 'C:\\docs\\open.mmd', 'v', '<svg viewBox="0 0 10 10">open</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">block</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">expanded</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.mmd', 'v', '<svg viewBox="0 0 10 10">closed</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">closed block</svg>')

        pruneSvgCache(['C:\\docs\\open.mmd', 'C:\\docs\\notes.md'])

        expect(readLatestSvg(THEME, 'C:\\docs\\open.mmd', BROKEN)).toBe('<svg viewBox="0 0 10 10">open</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid', BROKEN)).toBe('<svg viewBox="0 0 10 10">block</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid', BROKEN)).toBe(
            '<svg viewBox="0 0 10 10">expanded</svg>'
        )
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.mmd', BROKEN)).toBeNull()
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid', BROKEN)).toBeNull()
    })
})
