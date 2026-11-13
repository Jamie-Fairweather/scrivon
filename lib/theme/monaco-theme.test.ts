import { describe, expect, it, vi } from 'vitest'
import { APP_THEME_IDS, isLightTheme } from '@/lib/theme/catalog'
import { MONACO_DIAGRAM_THEME_ID, buildMonacoDiagramTheme, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { resolveThemeTokensForId } from '@/lib/theme/resolve-theme-tokens'
import { hexColorMix } from '@/lib/theme/color-mix'
import { TokenTheme } from 'monaco-editor/editor/common/languages/supports/tokenization.js'
import { vs, vs_dark } from 'monaco-editor/editor/standalone/common/themes.js'
import { MERMAID_LANGUAGE_ID, mermaidMonarchLanguage } from '@/lib/monaco/mermaid-language'
import { MERMAID_SNIPPETS } from '@/lib/monaco/mermaid-snippets'
import { registerMonarchLanguage, tokenizeLines } from '@/vitest/monarch'

// Monaco throws "Illegal value for token color" for anything else in a token rule.
const TOKEN_COLOR = /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i
const WIDGET_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

describe('buildMonacoDiagramTheme', () => {
    it.each(APP_THEME_IDS)('gives %s valid syntax and widget colours', (id) => {
        const theme = buildMonacoDiagramTheme(resolveThemeTokensForId(id), isLightTheme(id))

        expect(theme.rules.length).toBeGreaterThan(0)
        for (const rule of theme.rules) {
            if (rule.foreground !== undefined) expect(rule.foreground, rule.token).toMatch(TOKEN_COLOR)
        }
        for (const [key, value] of Object.entries(theme.colors)) {
            expect(value, key).toMatch(WIDGET_COLOR)
        }
    })

    it('colours headings, links and code from the palette instead of VS Code defaults', () => {
        const tokens = resolveThemeTokensForId('nord')
        const theme = buildMonacoDiagramTheme(tokens, false)
        const rule = (token: string) => theme.rules.find((r) => r.token === token)

        expect(rule('keyword')).toMatchObject({ foreground: tokens.accent, fontStyle: 'bold' })
        expect(rule('string.link')?.foreground).toBe(tokens.accent)
        // The base theme colours these, so they must be overridden for inline HTML in Markdown.
        for (const token of ['string', 'variable', 'comment', 'tag', 'attribute.name', 'string.html', 'delimiter.html']) {
            expect(rule(token)?.foreground, token).toBeDefined()
        }
    })

    it('styles the suggestion list, find box and context menu', () => {
        const tokens = resolveThemeTokensForId('catppuccin-latte')
        const { colors } = buildMonacoDiagramTheme(tokens, true)

        for (const key of [
            'editorSuggestWidget.selectedBackground',
            'list.activeSelectionBackground',
            'quickInputList.focusBackground',
            'input.background',
            'editor.findMatchBackground',
            'editor.findMatchHighlightBackground',
            'menu.background',
            'menu.selectionBackground',
        ]) {
            expect(colors[key], key).toBeDefined()
        }
        expect(colors['list.activeSelectionBackground']).not.toBe('#0060C0')
        expect(colors['input.background']).toBe(tokens.bg)
        expect(colors['menu.background']).toBe(tokens.surface)
    })
})

// Every token Monaco's Markdown tokenizer (used for .md and .mmd) emits, with its '.md' postfix.
const MARKDOWN_TOKENS = [
    'keyword.md',
    'keyword.table.header.md',
    'keyword.table.left.md',
    'keyword.table.middle.md',
    'meta.separator.md',
    'comment.md',
    'comment.content.md',
    'string.md',
    'variable.md',
    'variable.source.md',
    'string.escape.md',
    'escape.md',
    'string.target.md',
    'string.link.md',
    'strong.md',
    'emphasis.md',
    'tag.md',
    'attribute.name.html.md',
    'delimiter.html.md',
    'string.html.md',
    'white.md',
]

/** Resolves a token's colour the way Monaco's standalone theme service does (base rules, then ours). */
function resolvedTokenColor(id: (typeof APP_THEME_IDS)[number], token: string): string {
    const isLight = isLightTheme(id)
    const theme = buildMonacoDiagramTheme(resolveThemeTokensForId(id), isLight)
    const base = isLight ? vs : vs_dark
    const rules = [...base.rules, { token: '', foreground: theme.colors['editor.foreground'] }, ...theme.rules]
    const tokenTheme = TokenTheme.createFromRawTokenTheme(rules, [])
    const foregroundId = (tokenTheme._match(token).metadata & 0xff8000) >>> 15
    return String(tokenTheme.getColorMap()[foregroundId]).toLowerCase()
}

/** WCAG 2.x contrast ratio, computed here independently of the theme code. */
function contrast(a: string, b: string): number {
    const luminance = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16) / 255)
        const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!)
    }
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
}

describe('Markdown syntax colours in the editor', () => {
    it.each(APP_THEME_IDS)("are all set by the %s editor theme, none left to Monaco's base theme", (id) => {
        const tokens = resolveThemeTokensForId(id)
        const theme = buildMonacoDiagramTheme(tokens, isLightTheme(id))
        const ours = new Set([tokens.fg, ...theme.rules.flatMap((r) => (r.foreground ? [r.foreground] : []))].map((c) => c.toLowerCase()))
        for (const token of MARKDOWN_TOKENS) {
            expect(ours, token).toContain(resolvedTokenColor(id, token))
        }
    })

    it.each(APP_THEME_IDS)('are readable in %s, also on the current line', (id) => {
        const tokens = resolveThemeTokensForId(id)
        for (const token of MARKDOWN_TOKENS) {
            const color = resolvedTokenColor(id, token)
            // Body text is the palette's own text colour.
            if (color === tokens.fg.toLowerCase()) continue
            for (const background of [tokens.bg, tokens.surface]) {
                expect(contrast(color, background), `${token} ${color} on ${background}`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })

    it('keeps the palette colours where they are already readable, and softer text softer than body text', () => {
        const tokens = resolveThemeTokensForId('nord')
        const theme = buildMonacoDiagramTheme(tokens, false)
        const rule = (token: string) => theme.rules.find((r) => r.token === token)
        expect(rule('keyword')?.foreground).toBe(tokens.accent)
        expect(rule('string')?.foreground).toBe(hexColorMix(tokens.accent, tokens.fg, 50))

        // One Dark's secondary text is too faint (about 3.3:1), so it is moved toward the body text.
        const oneDark = resolveThemeTokensForId('one-dark')
        const comment = buildMonacoDiagramTheme(oneDark, false).rules.find((r) => r.token === 'comment')!.foreground!
        expect(comment).not.toBe(oneDark.textSecondary)
        expect(contrast(comment, oneDark.bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(comment, oneDark.bg)).toBeLessThan(contrast(oneDark.fg, oneDark.bg))
    })
})

/** How far apart a colour's red, green and blue are: 0 for a pure grey. */
function hueSpread(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.replace('#', '').slice(i - 1, i + 1), 16))
    return Math.max(r!, g!, b!) - Math.min(r!, g!, b!)
}

describe('Markdown syntax colours on themes without a colour of their own', () => {
    // Scrivon and Zinc have a grey accent, so colours built from it would all look like body text.
    it.each(['scrivon-dark', 'scrivon-light', 'zinc-dark', 'zinc-light'] as const)(
        'gives headings, code and quotes in %s their own colours, not greys',
        (id) => {
            const colors = ['keyword.md', 'string.md', 'variable.md', 'comment.md', 'string.link.md'].map((token) => resolvedTokenColor(id, token))

            for (const color of colors) expect(hueSpread(color), color).toBeGreaterThan(40)
            // Headings, code fences, inline code and quotes are told apart by colour alone.
            expect(new Set(colors.slice(0, 4)).size).toBe(4)
        }
    )

    it("uses VS Code's own colours there, as the editor did before themes had syntax colours", () => {
        expect(resolvedTokenColor('scrivon-dark', 'keyword.md')).toBe('#569cd6')
        expect(resolvedTokenColor('scrivon-dark', 'string.md')).toBe('#ce9178')
        expect(resolvedTokenColor('scrivon-light', 'keyword.md')).toBe('#0000ff')
        expect(resolvedTokenColor('scrivon-light', 'string.md')).toBe('#a31515')
    })
})

registerMonarchLanguage(MERMAID_LANGUAGE_ID, mermaidMonarchLanguage)

/** Every token type the Mermaid grammar gives the starters and a few more lines. */
const MERMAID_TOKENS = [
    ...new Set(
        [
            ...MERMAID_SNIPPETS.map((snippet) => snippet.body),
            '---\ntitle: Flow\n---\ngraph TD\n  %% note\n  A:::warn -.-> B((Round))\n  classDef warn fill:#f96\n  linkStyle 0 stroke:#333',
        ].flatMap((text) => tokenizeLines(MERMAID_LANGUAGE_ID, text).flatMap((line) => line.map(([, type]) => type)))
    ),
].filter((type) => type !== '')

describe('Mermaid syntax colours in the editor', () => {
    it('cover every kind of Mermaid syntax', () => {
        expect(MERMAID_TOKENS).toEqual(
            expect.arrayContaining([
                'keyword.mermaid',
                'operator.mermaid',
                'string.mermaid',
                'delimiter.bracket.mermaid',
                'delimiter.mermaid',
                'comment.mermaid',
                'type.mermaid',
                'number.mermaid',
                'attribute.name.mermaid',
                'meta.separator.mermaid',
            ])
        )
    })

    it.each(APP_THEME_IDS)("are all set by the %s editor theme, none left to Monaco's base theme", (id) => {
        const tokens = resolveThemeTokensForId(id)
        const theme = buildMonacoDiagramTheme(tokens, isLightTheme(id))
        const ours = new Set([tokens.fg, ...theme.rules.flatMap((r) => (r.foreground ? [r.foreground] : []))].map((c) => c.toLowerCase()))
        for (const token of MERMAID_TOKENS) {
            expect(ours, token).toContain(resolvedTokenColor(id, token))
        }
    })

    it.each(APP_THEME_IDS)('are readable in %s, also on the current line', (id) => {
        const tokens = resolveThemeTokensForId(id)
        for (const token of MERMAID_TOKENS) {
            const color = resolvedTokenColor(id, token)
            for (const background of [tokens.bg, tokens.surface]) {
                expect(contrast(color, background), `${token} ${color} on ${background}`).toBeGreaterThanOrEqual(4.5)
            }
        }
    })

    it.each(['scrivon-dark', 'scrivon-light', 'zinc-dark', 'zinc-light', 'nord', 'dracula'] as const)(
        'tell keywords, arrows, labels, comments and class names apart by colour in %s',
        (id) => {
            const colors = ['keyword.mermaid', 'operator.mermaid', 'string.mermaid', 'comment.mermaid', 'type.mermaid'].map((token) =>
                resolvedTokenColor(id, token)
            )
            expect(new Set(colors).size).toBe(colors.length)
        }
    )

    it.each(['scrivon-dark', 'scrivon-light', 'zinc-dark'] as const)('are colours, not greys, in %s', (id) => {
        for (const token of ['keyword.mermaid', 'operator.mermaid', 'string.mermaid', 'type.mermaid']) {
            const color = resolvedTokenColor(id, token)
            expect(hueSpread(color), `${token} ${color}`).toBeGreaterThan(40)
        }
    })

    it('leave Mermaid keywords at normal weight, unlike Markdown headings', () => {
        const theme = buildMonacoDiagramTheme(resolveThemeTokensForId('scrivon-dark'), false)
        expect(theme.rules.find((r) => r.token === 'keyword.mermaid')?.fontStyle).toBe('')
        expect(theme.rules.find((r) => r.token === 'keyword')?.fontStyle).toBe('bold')
    })
})

describe('defineMonacoDiagramTheme', () => {
    it('registers the theme under the app theme id', () => {
        const defineTheme = vi.fn()
        const monaco = { editor: { defineTheme } } as unknown as typeof import('monaco-editor')
        const tokens = resolveThemeTokensForId('dracula')

        defineMonacoDiagramTheme(monaco, tokens, false)

        expect(defineTheme).toHaveBeenCalledWith(MONACO_DIAGRAM_THEME_ID, buildMonacoDiagramTheme(tokens, false))
    })
})
