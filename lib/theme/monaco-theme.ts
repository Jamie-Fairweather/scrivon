import type { editor } from 'monaco-editor'
import { ensureContrast, hexColorMix, parseHexColor } from '@/lib/theme/color-mix'
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

/** The colour each kind of Markdown syntax gets, before it is made readable on the theme's background. */
type SyntaxColors = {
    heading: string
    link: string
    /** Code fences and indented code. */
    code: string
    /** Inline code and the inside of fenced code. */
    inlineCode: string
    /** Block quotes and HTML comments. */
    quote: string
    tag: string
    attribute: string
    htmlString: string
}

/**
 * VS Code's own syntax colours (from Monaco's built-in vs and vs-dark themes), for palettes with no
 * colour of their own: Scrivon and Zinc have a grey accent, so colours built from it are all grey.
 */
const VSCODE_SYNTAX: Record<'light' | 'dark', SyntaxColors> = {
    light: {
        heading: '#0000ff',
        link: '#a31515',
        code: '#a31515',
        inlineCode: '#001188',
        quote: '#008000',
        tag: '#800000',
        attribute: '#ff0000',
        htmlString: '#0000ff',
    },
    dark: {
        heading: '#569cd6',
        link: '#ce9178',
        code: '#ce9178',
        inlineCode: '#74b0df',
        quote: '#608b4e',
        tag: '#569cd6',
        attribute: '#9cdcfe',
        htmlString: '#ce9178',
    },
}

/**
 * How far apart a colour's red, green and blue (0-255) can be while it still counts as a grey.
 * Scrivon's and Zinc's accents are 1 apart at most; the least colourful theme accent (Nord's) is 72.
 */
const GREY_SPREAD = 24

/** True when a colour has no hue to speak of, so syntax in it would look like body text. */
function isGrey(hex: string): boolean {
    const rgb = parseHexColor(hex)
    if (!rgb) return true
    return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < GREY_SPREAD
}

/** Syntax colours from the palette's accent, so they match the theme instead of VS Code's blues and reds. */
function paletteSyntax(tokens: ResolvedThemeTokens): SyntaxColors {
    const code = hexColorMix(tokens.accent, tokens.fg, 50)
    return {
        heading: tokens.accent,
        link: tokens.accent,
        code,
        inlineCode: code,
        quote: tokens.textSecondary,
        tag: code,
        attribute: tokens.textSecondary,
        htmlString: code,
    }
}

/**
 * Syntax colours for Monaco's Markdown tokenizer (also used for .mmd files): from the palette when it
 * has a colour of its own, VS Code's otherwise. Every rule is set here, so none falls back to the base theme.
 */
function tokenRules(tokens: ResolvedThemeTokens, isLight: boolean): editor.ITokenThemeRule[] {
    // Readable on the editor background and on the current line's highlight, in every palette.
    const readable = (color: string) => ensureContrast(color, tokens.fg, [tokens.bg, tokens.surface], MIN_TEXT_CONTRAST)
    const syntax = isGrey(tokens.accent) ? VSCODE_SYNTAX[isLight ? 'light' : 'dark'] : paletteSyntax(tokens)
    const heading = readable(syntax.heading)
    const link = readable(syntax.link)
    const code = readable(syntax.code)
    const inlineCode = readable(syntax.inlineCode)
    const quote = readable(syntax.quote)
    const secondary = readable(tokens.textSecondary)
    return [
        // Headings, list markers and table pipes.
        { token: 'keyword', foreground: heading, fontStyle: 'bold' },
        { token: 'meta.separator', foreground: secondary },
        { token: 'string.link', foreground: link },
        { token: 'string.target', foreground: link },
        { token: 'string.escape', foreground: secondary },
        { token: 'escape', foreground: secondary },
        // Code fences and indented code, then inline code and the inside of fenced code.
        { token: 'string', foreground: code },
        { token: 'variable', foreground: inlineCode },
        { token: 'variable.source', foreground: inlineCode },
        // Block quote markers and HTML comments.
        { token: 'comment', foreground: quote, fontStyle: 'italic' },
        { token: 'comment.content', foreground: quote, fontStyle: 'italic' },
        // Inline HTML.
        { token: 'tag', foreground: readable(syntax.tag) },
        { token: 'attribute.name', foreground: readable(syntax.attribute) },
        { token: 'string.html', foreground: readable(syntax.htmlString) },
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
        rules: tokenRules(tokens, isLight),
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
