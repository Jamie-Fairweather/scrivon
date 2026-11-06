// Monaco's ESM entry points used by setup-monaco.ts ship without type declarations.
declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
    export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/editor/editor.worker.js'

// Monaco internals used by lib/theme/monaco-theme.test.ts to resolve token colours the way the editor does.
declare module 'monaco-editor/esm/vs/editor/standalone/common/themes.js' {
    import type { editor } from 'monaco-editor'
    export const vs: editor.IStandaloneThemeData
    export const vs_dark: editor.IStandaloneThemeData
}

declare module 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js' {
    import type { editor } from 'monaco-editor'
    export class TokenTheme {
        static createFromRawTokenTheme(rules: editor.ITokenThemeRule[], customTokenColors: string[]): TokenTheme
        getColorMap(): ({ toString(): string } | undefined)[]
        _match(token: string): { readonly metadata: number }
    }
}
