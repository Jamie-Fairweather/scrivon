import { describe, expect, it } from 'vitest'
import { fallbackPdfExportTitle, parsePdfExportFrontMatter, pdfPageNumberTemplate, resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'

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

    it('skips blank values and nested or list values', () => {
        const source = `---
title:
tags:
  - draft
  - notes
# a comment
subtitle: Keep
---
text
`
        expect(parsePdfExportFrontMatter(source)).toEqual({ matter: { subtitle: 'Keep' }, body: 'text\n' })
    })

    it('keeps paragraphs that sit between two horizontal rules', () => {
        for (const source of [
            '---\nWelcome to the project.\n\nSome text.\n\n---\n\n## Section\n',
            '---\n# Welcome\n---\nBody',
            '---\n- one\n- two\n---\nBody',
            '---\ntitle: Report\nThis line is not YAML.\n---\nBody',
        ]) {
            expect(parsePdfExportFrontMatter(source)).toEqual({ matter: {}, body: source })
        }
    })

    it('only closes on a --- line of its own', () => {
        // `----` and a pipe-less table divider are not the closing fence.
        expect(parsePdfExportFrontMatter('---\ntitle: Report\n----\n# Body\n').body).toBe('---\ntitle: Report\n----\n# Body\n')
        expect(parsePdfExportFrontMatter('---\ntitle: Report\n---|---\na|b\n').matter).toEqual({})
        expect(parsePdfExportFrontMatter('---\r\ntitle: Report\r\n---  \r\n# Body')).toEqual({ matter: { title: 'Report' }, body: '# Body' })
        expect(parsePdfExportFrontMatter('---\ntitle: Report\n---')).toEqual({ matter: { title: 'Report' }, body: '' })
    })
})

describe('fallbackPdfExportTitle', () => {
    it('prefers the first heading, then tab basename, then Document', () => {
        expect(fallbackPdfExportTitle('# Title\n\nHi', 'x.md')).toBe('Title')
        expect(fallbackPdfExportTitle('No heading', 'notes.md')).toBe('notes')
        expect(fallbackPdfExportTitle('No heading', '.md')).toBe('Document')
        expect(fallbackPdfExportTitle('No heading', undefined)).toBe('Document')
    })

    it('skips hashes inside fenced code', () => {
        expect(fallbackPdfExportTitle('```bash\n# install deps\n```\n\n# Real Title', 'x.md')).toBe('Real Title')
        expect(fallbackPdfExportTitle('```bash\n# install deps\n```\n', 'notes.md')).toBe('notes')
    })

    it('reads the heading as plain text', () => {
        expect(fallbackPdfExportTitle('# Using `foo` **bold** [link](http://x)', 'x.md')).toBe('Using foo bold link')
        expect(fallbackPdfExportTitle('# Title #', 'x.md')).toBe('Title')
        expect(fallbackPdfExportTitle('# ![logo](logo.png) Project', 'x.md')).toBe('Project')
    })

    it('counts setext headings and ignores lower levels', () => {
        expect(fallbackPdfExportTitle('Setext Title\n============\n\nBody', 'x.md')).toBe('Setext Title')
        expect(fallbackPdfExportTitle('## Section\n\nSub\n---\n\n# Main', 'x.md')).toBe('Main')
    })
})

describe('pdfPageNumberTemplate', () => {
    it('returns an empty template unless numbering is custom', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'number'
        expect(pdfPageNumberTemplate(profile, { title: 'Spec', subtitle: '', author: '', date: '' })).toBe('')
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
