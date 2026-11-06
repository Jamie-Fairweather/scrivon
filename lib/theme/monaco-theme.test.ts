import { describe, expect, it, vi } from 'vitest'
import { APP_THEME_IDS, isLightTheme } from '@/lib/theme/catalog'
import { MONACO_DIAGRAM_THEME_ID, buildMonacoDiagramTheme, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { resolveThemeTokensForId } from '@/lib/theme/resolve-theme-tokens'
import { hexColorMix } from '@/lib/theme/color-mix'
import { TokenTheme } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js'
import { vs, vs_dark } from 'monaco-editor/esm/vs/editor/standalone/common/themes.js'

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

describe('Markdown syntax colours in the editor', () => {
    it.each(APP_THEME_IDS)('come only from the %s palette', (id) => {
        const tokens = resolveThemeTokensForId(id)
        const palette = new Set(
            [tokens.fg, tokens.accent, tokens.textSecondary, hexColorMix(tokens.accent, tokens.fg, 50)].map((c) => c.toLowerCase())
        )
        for (const token of MARKDOWN_TOKENS) {
            expect(palette, token).toContain(resolvedTokenColor(id, token))
        }
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
