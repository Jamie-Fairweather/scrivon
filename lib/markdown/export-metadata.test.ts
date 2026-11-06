import { describe, expect, it } from 'vitest'
import {
    fallbackPdfExportTitle,
    guessDocumentLanguage,
    parsePdfExportFrontMatter,
    pdfPageNumberFormat,
    pdfPageNumberParts,
    pdfPageNumberTemplate,
    resolvePdfExportMetadata,
} from '@/lib/markdown/export-metadata'
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

describe('front matter lang', () => {
    it('reads a valid language tag and ignores anything else', () => {
        expect(parsePdfExportFrontMatter('---\nlang: ja\n---\nBody')).toEqual({ matter: {}, body: 'Body', lang: 'ja' })
        expect(parsePdfExportFrontMatter("---\nlang: 'zh-Hant-TW'\ntitle: T\n---\nBody").lang).toBe('zh-Hant-TW')
        expect(parsePdfExportFrontMatter('---\nlang: "><script>\n---\nBody').lang).toBeUndefined()
        expect(parsePdfExportFrontMatter('---\nlang: Japanese language\n---\nBody').lang).toBeUndefined()
        expect(resolvePdfExportMetadata('---\nlang: en-GB\n---\n# Hi', undefined).lang).toBe('en-GB')
    })
})

describe('guessDocumentLanguage', () => {
    it('tags text by the script that leads it', () => {
        expect(guessDocumentLanguage('骨角器と直線の写真について説明します。')).toBe('ja')
        // Technical Japanese with plenty of English terms is still Japanese.
        expect(guessDocumentLanguage('Scrivon の export 機能で PDF と Word を作成します。')).toBe('ja')
        expect(guessDocumentLanguage('这是一个关于导出文档的说明。')).toBe('zh')
        expect(guessDocumentLanguage('문서를 내보내는 방법을 설명합니다.')).toBe('ko')
        expect(guessDocumentLanguage('هذا مستند باللغة العربية.')).toBe('ar')
        expect(guessDocumentLanguage('זהו מסמך בעברית.')).toBe('he')
    })

    it('stays English for Latin text, a stray foreign word, or no letters at all', () => {
        expect(guessDocumentLanguage('A plain English document about exports.')).toBe('en')
        expect(guessDocumentLanguage('The Japanese word for photograph is 写真, and it is used everywhere in this long guide.')).toBe('en')
        expect(guessDocumentLanguage('Привет, мир')).toBe('en')
        expect(guessDocumentLanguage('123 — !!!')).toBe('en')
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

describe('pdfPageNumberParts', () => {
    const meta = (title: string) => ({ title, subtitle: '', author: '', date: '' })
    const custom = (text: string) => {
        const profile = createDefaultPdfExportProfile()
        profile.footer.pageNumbers = 'custom'
        profile.footer.right.text = text
        return profile
    }

    it('gives the stamper the whole text when its font can draw it', () => {
        const profile = custom('{{title}} – {{page}}/{{total}} … Acme™ €')
        expect(pdfPageNumberParts(profile, meta('Café Spec'))).toEqual({ before: '', counter: 'Café Spec – {{page}}/{{total}} … Acme™ €', after: '' })
        expect(pdfPageNumberFormat(profile, meta('Café Spec'))).toBe('custom:Café Spec – {{page}}/{{total}} … Acme™ €')
    })

    it('keeps text the stamper would print as ? out of what it draws', () => {
        const profile = custom('{{title}} · {{page}}/{{total}}')
        expect(pdfPageNumberParts(profile, meta('Отчёт о продажах'))).toEqual({
            before: 'Отчёт о продажах ·',
            counter: '{{page}}/{{total}}',
            after: '',
        })
        expect(pdfPageNumberFormat(profile, meta('Отчёт о продажах'))).toBe('custom:{{page}}/{{total}}')

        const around = custom('Strona {{ page }} z {{total}} · Zażółć')
        expect(pdfPageNumberParts(around, meta(''))).toEqual({ before: 'Strona', counter: '{{ page }} z {{total}}', after: '· Zażółć' })
        expect(pdfPageNumberParts(custom('{{page}} 東京'), meta(''))).toEqual({ before: '', counter: '{{page}}', after: '東京' })
    })

    it('is null when the custom text counts nothing', () => {
        expect(pdfPageNumberParts(custom('{{title}}'), meta('Отчёт'))).toBeNull()
        expect(pdfPageNumberFormat(custom('{{title}}'), meta('Отчёт'))).toBe('none')
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
