import { createHighlighter } from 'shiki'
import { describe, expect, it } from 'vitest'
import { EXPORT_CODE_THEMES, exportCodeTheme, type ShikiTheme } from '@/lib/markdown/code-themes'

/** `#fff`, `#ffffff` or `#2e3440ff` as six upper-case hex digits. */
function sixDigits(color: string): string {
    const hex = color.replace('#', '').toUpperCase()
    return hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex.slice(0, 6)
}

describe('export code themes', () => {
    it('offers GitHub’s two and at least three more', () => {
        const ids = EXPORT_CODE_THEMES.map((theme) => theme.id)
        expect(ids).toEqual(expect.arrayContaining(['github-light', 'github-dark']))
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids.length).toBeGreaterThanOrEqual(5)
    })

    it('falls back to GitHub Light for a theme this version doesn’t know', () => {
        expect(exportCodeTheme('nord').background).toBe('2E3440')
        expect(exportCodeTheme('monokai' as ShikiTheme).id).toBe('github-light')
    })

    it('gives Word code blocks the colours each theme draws in the PDF', async () => {
        const highlighter = await createHighlighter({ themes: EXPORT_CODE_THEMES.map((theme) => theme.id), langs: [] })
        // GitHub's keep the code-block colours of GitHub's site, which Word export has always used.
        for (const theme of EXPORT_CODE_THEMES.filter(({ id }) => !id.startsWith('github-'))) {
            const shiki = highlighter.getTheme(theme.id)
            expect({ id: theme.id, background: theme.background, text: theme.text }).toEqual({
                id: theme.id,
                background: sixDigits(shiki.bg),
                text: sixDigits(shiki.fg),
            })
        }
    })
})
