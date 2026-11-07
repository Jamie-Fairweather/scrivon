import { describe, expect, it } from 'vitest'
import { resolveHeadingAnchor, safeExportHref } from '@/lib/markdown/export-links'

describe('safeExportHref', () => {
    it('keeps web, email and relative addresses', () => {
        for (const url of [
            'https://example.com/a?b#c',
            'http://example.com',
            'mailto:me@example.com',
            'other.md',
            './img/a.png',
            '#intro',
            '/docs/a.md',
        ]) {
            expect(safeExportHref(url), url).toBe(url)
        }
    })

    it('drops addresses that would run or open something on the reader’s computer', () => {
        for (const url of [
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'file:///C:/Windows/notepad.exe',
            'search-ms:query=x',
            'C:%5Cdocs%5Ca.md',
            'vbscript:x',
            '',
        ]) {
            expect(safeExportHref(url), url).toBeNull()
        }
    })
})

describe('resolveHeadingAnchor', () => {
    const ids = new Set(['résumé', 'setup-install', 'user-content-fn-1'])

    it('matches the fragment as written, percent-decoded, then in lower case', () => {
        expect(resolveHeadingAnchor('setup-install', ids)).toBe('setup-install')
        expect(resolveHeadingAnchor('r%C3%A9sum%C3%A9', ids)).toBe('résumé')
        expect(resolveHeadingAnchor('R%C3%A9sum%C3%A9', ids)).toBe('résumé')
        expect(resolveHeadingAnchor('Setup-Install', ids)).toBe('setup-install')
        expect(resolveHeadingAnchor('user-content-fn-1', ids)).toBe('user-content-fn-1')
    })

    it('leaves a fragment no id matches as it is, even when it is badly encoded', () => {
        expect(resolveHeadingAnchor('missing', ids)).toBe('missing')
        expect(resolveHeadingAnchor('%E0%A4%A', ids)).toBe('%E0%A4%A')
        expect(resolveHeadingAnchor('', ids)).toBe('')
    })
})
