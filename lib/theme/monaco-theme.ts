import type { editor } from 'monaco-editor'
import { hexColorMix } from '@/lib/theme/color-mix'
import type { ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'

export const MONACO_DIAGRAM_THEME_ID = 'scrivon-diagram'

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

export function defineMonacoDiagramTheme(monaco: typeof import('monaco-editor'), tokens: ResolvedThemeTokens, isLight: boolean) {
    const rules: editor.ITokenThemeRule[] = []
    const selection = editorSelectionColors(tokens, isLight)

    const theme: editor.IStandaloneThemeData = {
        base: isLight ? 'vs' : 'vs-dark',
        inherit: true,
        rules,
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
            'editorLineNumber.foreground': tokens.textFaint,
            'editorLineNumber.activeForeground': tokens.textSecondary,
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
        },
    }

    monaco.editor.defineTheme(MONACO_DIAGRAM_THEME_ID, theme)
}
