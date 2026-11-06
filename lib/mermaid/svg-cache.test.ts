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
        storeSvg(THEME, 'a.mmd', 'graph TD', '<svg viewBox="0 0 10 10">1</svg>')

        expect(readCachedSvg(THEME, 'a.mmd', 'graph TD')).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'graph LR')).toBeNull()
        expect(readCachedSvg('scrivon-dark', 'a.mmd', 'graph TD')).toBeNull()
        expect(readCachedSvg(THEME, 'b.mmd', 'graph TD')).toBeNull()
    })

    it('falls back to the newest render of a document, not the oldest', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>')
        storeSvg(THEME, 'a.mmd', 'v3', '<svg viewBox="0 0 10 10">3</svg>')

        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg viewBox="0 0 10 10">3</svg>')
    })

    it('prefers a render in this theme, and falls back to another theme rather than nothing (U38)', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">light 1</svg>')
        expect(readLatestSvg('scrivon-dark', 'a.mmd')).toBe('<svg viewBox="0 0 10 10">light 1</svg>')

        storeSvg('scrivon-dark', 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">dark 1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">light 2</svg>')
        expect(readLatestSvg('scrivon-dark', 'a.mmd')).toBe('<svg viewBox="0 0 10 10">dark 1</svg>')
        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg viewBox="0 0 10 10">light 2</svg>')
        expect(readLatestSvg(THEME, 'b.mmd')).toBeNull()
    })

    it('does not fall back past a render that had nothing to draw (U39)', () => {
        storeSvg(THEME, 'a.mmd', 'graph TD\n  A', '<svg viewBox="0 0 10 10"></svg>')
        storeSvg(THEME, 'a.mmd', 'graph TD', '<svg viewBox="0 0 0 0" width="0" height="0"></svg>')

        expect(readLatestSvg(THEME, 'a.mmd')).toBeNull()
        expect(readCachedSvg(THEME, 'a.mmd', 'graph TD')).toBe('<svg viewBox="0 0 0 0" width="0" height="0"></svg>')
    })

    it('knows whether a document already rendered or failed in a theme (U38)', () => {
        expect(hasRenderedInTheme(THEME, 'a.mmd')).toBe(false)
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10"/>')
        expect(hasRenderedInTheme(THEME, 'a.mmd')).toBe(true)
        expect(hasRenderedInTheme('scrivon-dark', 'a.mmd')).toBe(false)

        storeRenderError(THEME, 'b.mmd', 'graph', 'Bad header')
        expect(hasRenderedInTheme(THEME, 'b.mmd')).toBe(true)
    })

    it('treats re-rendering an older source as the newest render', () => {
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')
        storeSvg(THEME, 'a.mmd', 'v2', '<svg viewBox="0 0 10 10">2</svg>')
        storeSvg(THEME, 'a.mmd', 'v1', '<svg viewBox="0 0 10 10">1</svg>')

        expect(readLatestSvg(THEME, 'a.mmd')).toBe('<svg viewBox="0 0 10 10">1</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v2')).toBe('<svg viewBox="0 0 10 10">2</svg>')
    })

    it('keeps only the last few renders of each document', () => {
        for (let i = 1; i <= 50; i++) storeSvg(THEME, 'a.mmd', `v${i}`, `<svg viewBox="0 0 10 10">${i}</svg>`)

        expect(readCachedSvg(THEME, 'a.mmd', 'v50')).toBe('<svg viewBox="0 0 10 10">50</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v49')).toBe('<svg viewBox="0 0 10 10">49</svg>')
        expect(readCachedSvg(THEME, 'a.mmd', 'v1')).toBeNull()
        expect(readCachedSvg(THEME, 'a.mmd', 'v45')).toBeNull()
    })

    it('drops the least recently rendered documents once there are too many', () => {
        storeSvg(THEME, 'first.mmd', 'v', '<svg viewBox="0 0 10 10">first</svg>')
        storeSvg(THEME, 'kept.mmd', 'v', '<svg viewBox="0 0 10 10">kept</svg>')
        for (let i = 0; i < 98; i++) storeSvg(THEME, `doc-${i}.mmd`, 'v', '<svg viewBox="0 0 10 10"/>')
        storeSvg(THEME, 'kept.mmd', 'v2', '<svg viewBox="0 0 10 10">kept 2</svg>')

        storeSvg(THEME, 'one-more.mmd', 'v', '<svg viewBox="0 0 10 10"/>')

        expect(readLatestSvg(THEME, 'first.mmd')).toBeNull()
        expect(readLatestSvg(THEME, 'kept.mmd')).toBe('<svg viewBox="0 0 10 10">kept 2</svg>')
        expect(readLatestSvg(THEME, 'one-more.mmd')).toBe('<svg viewBox="0 0 10 10"/>')
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
        storeSvg(THEME, 'a.mmd', 'v', '<svg viewBox="0 0 10 10">a</svg>')
        storeRenderError(THEME, 'a.mmd', 'bad', 'Parse error')
        storeSvg(THEME, 'b.mmd', 'v', '<svg viewBox="0 0 10 10">b</svg>')

        forgetDocumentSvgs('a.mmd')

        expect(readLatestSvg(THEME, 'a.mmd')).toBeNull()
        expect(readRenderError(THEME, 'a.mmd', 'bad')).toBeNull()
        expect(readLatestSvg(THEME, 'b.mmd')).toBe('<svg viewBox="0 0 10 10">b</svg>')
    })

    it('prunes documents and blocks whose tab is closed', () => {
        storeSvg(THEME, 'C:\\docs\\open.mmd', 'v', '<svg viewBox="0 0 10 10">open</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">block</svg>')
        storeSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">expanded</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.mmd', 'v', '<svg viewBox="0 0 10 10">closed</svg>')
        storeSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid', 'v', '<svg viewBox="0 0 10 10">closed block</svg>')

        pruneSvgCache(['C:\\docs\\open.mmd', 'C:\\docs\\notes.md'])

        expect(readLatestSvg(THEME, 'C:\\docs\\open.mmd')).toBe('<svg viewBox="0 0 10 10">open</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:block:C:\\docs\\notes.md:0:mermaid')).toBe('<svg viewBox="0 0 10 10">block</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\notes.md:expanded:C:\\docs\\notes.md:0:mermaid')).toBe('<svg viewBox="0 0 10 10">expanded</svg>')
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.mmd')).toBeNull()
        expect(readLatestSvg(THEME, 'C:\\docs\\closed.md:block:C:\\docs\\closed.md:0:mermaid')).toBeNull()
    })
})
