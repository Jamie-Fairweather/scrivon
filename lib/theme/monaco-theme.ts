import type { editor } from 'monaco-editor'
import { ensureContrast, hexColorMix } from '@/lib/theme/color-mix'
import type { ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'

export const MONACO_DIAGRAM_THEME_ID = 'scrivon-diagram'

/** WCAG AA for normal text. The editor's 13px text, bold headings included, is not large text. */
const MIN_TEXT_CONTRAST = 4.5

function editorSelectionColors(tokens: ResolvedThemeTokens, isLight: boolean) {
    const activeMix = isLight ? 22 : 30
    const inactiveMix = isLight ? 14 : 20
    const matchMix = isLight ? 12 : 16

    return {
        selectionBackground: hexColorMix(tokens.fg, tokens.bg, activeMix),
        inactiveSelectionBackground: hexColorMix(tokens.fg, tokens.bg, inactiveMix),
        selectionHighlightBackground: hexColorMix(tokens.accent, tokens.bg, matchMix),
        selectionForeground: tokens.bg,
    }
}

/** Adds an alpha channel (0-255) to a #rrggbb colour, for highlights that must not hide what is under them. */
function withAlpha(hex: string, alpha: number): string {
    return `${hex}${Math.round(alpha).toString(16).padStart(2, '0')}`
}

/**
 * Syntax colours for Monaco's Markdown tokenizer (also used for .mmd files), taken from the
 * palette so headings, links and code don't fall back to VS Code's blues, reds and greens.
 */
function tokenRules(tokens: ResolvedThemeTokens): editor.ITokenThemeRule[] {
    // Readable on the editor background and on the current line's highlight, in every palette.
    const readable = (color: string) => ensureContrast(color, tokens.fg, [tokens.bg, tokens.surface], MIN_TEXT_CONTRAST)
    const accent = readable(tokens.accent)
    const secondary = readable(tokens.textSecondary)
    const code = readable(hexColorMix(tokens.accent, tokens.fg, 50))
    return [
        // Headings, list markers and table pipes.
        { token: 'keyword', foreground: accent, fontStyle: 'bold' },
        { token: 'meta.separator', foreground: secondary },
        { token: 'string.link', foreground: accent },
        { token: 'string.target', foreground: accent },
        { token: 'string.escape', foreground: secondary },
        { token: 'escape', foreground: secondary },
        // Code fences, indented code, inline code and fenced code.
        { token: 'string', foreground: code },
        { token: 'variable', foreground: code },
        { token: 'variable.source', foreground: code },
        // Block quote markers and HTML comments.
        { token: 'comment', foreground: secondary, fontStyle: 'italic' },
        { token: 'comment.content', foreground: secondary, fontStyle: 'italic' },
        // Inline HTML.
        { token: 'tag', foreground: code },
        { token: 'attribute.name', foreground: secondary },
        { token: 'string.html', foreground: code },
        { token: 'delimiter.html', foreground: secondary },
        { token: 'strong', fontStyle: 'bold' },
        { token: 'emphasis', fontStyle: 'italic' },
    ]
}

/**
 * Widget colours (suggestions, find box, context menu, hovers) so Monaco's popups match the
 * palette instead of stock VS Code blues and greys.
 */
function widgetColors(tokens: ResolvedThemeTokens, isLight: boolean): editor.IColors {
    const selected = hexColorMix(tokens.accent, tokens.bg, isLight ? 18 : 28)
    const hover = hexColorMix(tokens.fg, tokens.bg, 8)

    return {
        'input.background': tokens.bg,
        'input.foreground': tokens.fg,
        'input.border': tokens.border,
        'input.placeholderForeground': tokens.textSecondary,
        'inputOption.activeBorder': tokens.accent,
        'inputOption.activeBackground': selected,
        'inputOption.activeForeground': tokens.fg,
        'dropdown.background': tokens.surface,
        'dropdown.foreground': tokens.fg,
        'dropdown.border': tokens.border,
        'list.activeSelectionBackground': selected,
        'list.activeSelectionForeground': tokens.fg,
        'list.inactiveSelectionBackground': selected,
        'list.inactiveSelectionForeground': tokens.fg,
        'list.focusBackground': selected,
        'list.focusForeground': tokens.fg,
        'list.hoverBackground': hover,
        'list.hoverForeground': tokens.fg,
        'list.highlightForeground': tokens.accent,
        'list.focusHighlightForeground': tokens.accent,
        'quickInput.background': tokens.surface,
        'quickInput.foreground': tokens.fg,
        'quickInputList.focusBackground': selected,
        'quickInputList.focusForeground': tokens.fg,
        'editorSuggestWidget.background': tokens.surface,
        'editorSuggestWidget.border': tokens.border,
        'editorSuggestWidget.foreground': tokens.fg,
        'editorSuggestWidget.selectedBackground': selected,
        'editorSuggestWidget.selectedForeground': tokens.fg,
        'editorSuggestWidget.highlightForeground': tokens.accent,
        'editorSuggestWidget.focusHighlightForeground': tokens.accent,
        'editorWidget.foreground': tokens.fg,
        'editorHoverWidget.foreground': tokens.fg,
        'editor.findMatchBackground': hexColorMix(tokens.accent, tokens.bg, isLight ? 30 : 40),
        'editor.findMatchHighlightBackground': withAlpha(tokens.accent, isLight ? 0x40 : 0x55),
        'editor.findRangeHighlightBackground': withAlpha(tokens.fg, 0x14),
        'editorBracketMatch.background': withAlpha(tokens.accent, 0x26),
        'editorBracketMatch.border': tokens.accent,
        'editorLink.activeForeground': tokens.accent,
        'textLink.foreground': tokens.accent,
        'textLink.activeForeground': tokens.accent,
        'editorStickyScroll.background': tokens.bg,
        'toolbar.hoverBackground': hover,
        'menu.background': tokens.surface,
        'menu.foreground': tokens.fg,
        'menu.border': tokens.border,
        'menu.selectionBackground': selected,
        'menu.selectionForeground': tokens.fg,
        'menu.separatorBackground': tokens.border,
    }
}

export function buildMonacoDiagramTheme(tokens: ResolvedThemeTokens, isLight: boolean): editor.IStandaloneThemeData {
    const selection = editorSelectionColors(tokens, isLight)

    return {
        base: isLight ? 'vs' : 'vs-dark',
        inherit: true,
        rules: tokenRules(tokens),
        colors: {
            'editor.background': tokens.bg,
            'editor.foreground': tokens.fg,
            'editor.lineHighlightBackground': tokens.surface,
            'editor.lineHighlightBorder': tokens.border,
            'editor.selectionBackground': selection.selectionBackground,
            'editor.inactiveSelectionBackground': selection.inactiveSelectionBackground,
            'editor.selectionHighlightBackground': selection.selectionHighlightBackground,
            'editor.selectionForeground': selection.selectionForeground,
            'editorCursor.foreground': tokens.accent,
            'editorLineNumber.foreground': tokens.lineNumber,
            'editorLineNumber.activeForeground': tokens.activeLineNumber,
            'editorIndentGuide.background': tokens.line,
            'editorIndentGuide.activeBackground': tokens.border,
            'editorWhitespace.foreground': tokens.line,
            'editorWidget.border': tokens.border,
            'editorWidget.background': tokens.surface,
            'editorHoverWidget.background': tokens.surface,
            'editorHoverWidget.border': tokens.border,
            'scrollbarSlider.background': tokens.border,
            'scrollbarSlider.hoverBackground': tokens.muted,
            'scrollbarSlider.activeBackground': tokens.muted,
            focusBorder: tokens.accent,
            'minimap.background': tokens.bg,
            ...widgetColors(tokens, isLight),
        },
    }
}

export function defineMonacoDiagramTheme(monaco: typeof import('monaco-editor'), tokens: ResolvedThemeTokens, isLight: boolean) {
    monaco.editor.defineTheme(MONACO_DIAGRAM_THEME_ID, buildMonacoDiagramTheme(tokens, isLight))
}
