import { describe, expect, it } from 'vitest'
import { fallbackPdfExportTitle, parsePdfExportFrontMatter, resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'

describe('parsePdfExportFrontMatter', () => {
    it('returns the full source when front matter is absent', () => {
        const source = '# Hello\n\nWorld'
        expect(parsePdfExportFrontMatter(source)).toEqual({ matter: {}, body: source })
    })

    it('parses known keys and ignores others', () => {
        const source = `---
title: Report
subtitle: "Q1"
author: 'Ada'
date: 2026-01-01
unknown: skip
---
# Body
`
        const { matter, body } = parsePdfExportFrontMatter(source)
        expect(matter).toEqual({
            title: 'Report',
            subtitle: 'Q1',
            author: 'Ada',
            date: '2026-01-01',
        })
        expect(body).toBe('# Body\n')
    })

    it('skips blank values and malformed lines', () => {
        const source = `---
title: 
: missing-key
subtitle: Keep
---
text
`
        expect(parsePdfExportFrontMatter(source).matter).toEqual({ subtitle: 'Keep' })
    })
})

describe('fallbackPdfExportTitle', () => {
    it('prefers the first heading, then tab basename, then Document', () => {
        expect(fallbackPdfExportTitle('# Title\n\nHi', 'x.md')).toBe('Title')
        expect(fallbackPdfExportTitle('No heading', 'notes.md')).toBe('notes')
        expect(fallbackPdfExportTitle('No heading', '.md')).toBe('Document')
        expect(fallbackPdfExportTitle('No heading', undefined)).toBe('Document')
    })
})

describe('resolvePdfExportMetadata', () => {
    it('resolves overrides over front matter over fallbacks', () => {
        const source = `---
title: FM Title
author: FM Author
---
# Heading
`
        expect(resolvePdfExportMetadata(source, 'tab.md', { title: ' Override ', subtitle: 'S' })).toEqual({
            metadata: {
                title: 'Override',
                subtitle: 'S',
                author: 'FM Author',
                date: '',
            },
            body: '# Heading\n',
        })
    })
})
