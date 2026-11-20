// Monaco's worker entry point, used by lib/monaco/editor.worker.ts, ships without type declarations.
declare module 'monaco-editor/editor/editor.worker.js'

// Monaco internals used by lib/theme/monaco-theme.test.ts to resolve token colours the way the editor does.
declare module 'monaco-editor/editor/standalone/common/themes.js' {
    import type { editor } from 'monaco-editor'
    export const vs: editor.IStandaloneThemeData
    export const vs_dark: editor.IStandaloneThemeData
}

declare module 'monaco-editor/editor/common/languages/supports/tokenization.js' {
    import type { editor } from 'monaco-editor'
    export class TokenTheme {
        static createFromRawTokenTheme(rules: editor.ITokenThemeRule[], customTokenColors: string[]): TokenTheme
        getColorMap(): ({ toString(): string } | undefined)[]
        _match(token: string): { readonly metadata: number }
    }
}

// Monaco's URI parser, used by lib/monaco/model-keys.test.ts to read model keys the way the editor does.
declare module 'monaco-editor/base/common/uri.js' {
    export { Uri as URI } from 'monaco-editor'
}

// Monaco's opener service, used by lib/monaco/setup-monaco.ts to register the Ctrl+Click link opener
// directly, so it gets the link text as written instead of a parsed (percent-decoded) Uri.
declare module 'monaco-editor/platform/opener/common/opener.js' {
    import type { IDisposable, Uri } from 'monaco-editor'
    export interface IOpener {
        open(target: string | Uri, options?: object): Promise<boolean>
    }
    export interface IOpenerService {
        registerOpener(opener: IOpener): IDisposable
        open(target: string | Uri, options?: object): Promise<boolean>
    }
    /** The id StandaloneServices.get looks the service up by. */
    export const IOpenerService: { readonly type: IOpenerService }
}

// Monaco's global "Tab moves focus" mode, used by lib/monaco/tab-focus.ts. Setting it this way
// (not with the tabFocusMode editor option) leaves Ctrl+M able to switch it off again.
declare module 'monaco-editor/editor/browser/config/tabFocus.js' {
    import type { IDisposable } from 'monaco-editor'
    export const TabFocus: {
        getTabFocusMode(): boolean
        setTabFocusMode(tabFocusMode: boolean): void
        onDidChangeTabFocus(listener: (tabFocusMode: boolean) => void): IDisposable
    }
}

// Monaco's shared command registry, used by lib/monaco/paste-command.ts to take over Monaco's Paste.
declare module 'monaco-editor/platform/commands/common/commands.js' {
    import type { IDisposable } from 'monaco-editor'
    export const CommandsRegistry: {
        registerCommand(id: string, handler: (accessor: unknown, ...args: unknown[]) => unknown): IDisposable
        getCommand(id: string): { id: string; handler: (accessor: unknown, ...args: unknown[]) => unknown } | undefined
    }
}

// What the editor notes about text it copies (copied from several cursors, a whole line), used by
// lib/monaco/paste-command.ts to paste it back the way Ctrl+V does.
declare module 'monaco-editor/editor/browser/controller/editContext/clipboardUtils.js' {
    export type ClipboardStoredMetadata = {
        isFromEmptySelection: boolean | undefined
        multicursorText: string[] | null | undefined
        mode: string | null
    }
    export const InMemoryClipboardMetadataManager: {
        readonly INSTANCE: {
            set(lastCopiedValue: string, data: ClipboardStoredMetadata): void
            /** The notes on `pastedText` when it is what the editor copied last, or null. */
            get(pastedText: string): ClipboardStoredMetadata | null
        }
    }
}

// Monaco's clipboard commands and editor extensions, used by lib/monaco/paste-command.test.ts to check that Paste
// stays a plain command, which editor.trigger hands to the shared command registry (where Scrivon's Paste is).
declare module 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'

declare module 'monaco-editor/editor/browser/editorExtensions.js' {
    export const EditorExtensionsRegistry: {
        getEditorActions(): ReadonlyArray<{ readonly id: string }>
        getEditorCommand(commandId: string): { readonly id: string } | null
    }
}

declare module 'monaco-editor/editor/standalone/browser/standaloneServices.js' {
    export namespace StandaloneServices {
        function get<T>(serviceId: { readonly type: T }): T
        /**
         * Sets Monaco's services up, with each of `overrides` (keyed by the service's name) in place of Monaco's
         * own. Only the first call does anything, and `get` makes that call when nothing has yet.
         */
        function initialize(overrides: Record<string, unknown>): unknown
    }
}

// Used by lib/monaco/link-opener.test.ts to check the opener against Monaco's real service.
declare module 'monaco-editor/editor/browser/services/openerService.js' {
    import type { IOpenerService } from 'monaco-editor/platform/opener/common/opener.js'
    export class OpenerService implements IOpenerService {
        constructor(editorService: unknown, commandService: unknown)
        registerOpener: IOpenerService['registerOpener']
        open: IOpenerService['open']
    }
}

// Monaco's Monarch lexer, used by vitest/monarch.ts to check the Mermaid grammar the way the editor colours it.
declare module 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js' {
    import type { languages } from 'monaco-editor'
    export type CompiledLexer = { readonly languageId: string }
    export function compile(languageId: string, json: languages.IMonarchLanguage): CompiledLexer
}

declare module 'monaco-editor/editor/standalone/common/monarch/monarchLexer.js' {
    import type { languages } from 'monaco-editor'
    import type { CompiledLexer } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js'
    export class MonarchTokenizer {
        constructor(
            languageService: unknown,
            standaloneThemeService: unknown,
            languageId: string,
            lexer: CompiledLexer,
            configurationService: unknown
        )
        getInitialState(): languages.IState
        tokenize(line: string, hasEOL: boolean, state: languages.IState): { tokens: { offset: number; type: string }[]; endState: languages.IState }
    }
}

declare module 'monaco-editor/editor/common/languages.js' {
    import type { IDisposable } from 'monaco-editor'
    export const TokenizationRegistry: {
        register(languageId: string, support: unknown): IDisposable
    }
}

// Monaco's Markdown grammar, used by lib/monaco/mermaid-language.test.ts to check ```mermaid blocks.
declare module 'monaco-editor/languages/definitions/markdown/markdown.js' {
    import type { languages } from 'monaco-editor'
    export const language: languages.IMonarchLanguage
}

// Monaco's snippet parser, used by lib/monaco/mermaid-snippets.test.ts to expand snippets as the editor does.
declare module 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js' {
    export class SnippetParser {
        parse(value: string): { toString(): string }
    }
}

// Monaco's clipboard service, which lib/monaco/clipboard-service.ts replaces so the editor uses Tauri's clipboard.
declare module 'monaco-editor/platform/clipboard/common/clipboardService.js' {
    import type { Uri } from 'monaco-editor'
    export interface IClipboardService {
        readonly _serviceBrand: undefined
        /** The menus' Paste, where the host can paste (a desktop app); undefined to have the editor read the text. */
        triggerPaste(targetWindowId: number): Promise<void> | undefined
        /** With `type`, kept in memory under that name instead of put on the clipboard. */
        writeText(text: string, type?: string): Promise<void>
        readText(type?: string): Promise<string>
        readFindText(): Promise<string>
        writeFindText(text: string): Promise<void>
        writeResources(resources: Uri[]): Promise<void>
        readResources(): Promise<Uri[]>
        hasResources(): Promise<boolean>
        clearInternalState?(): void
        readImage(): Promise<Uint8Array>
    }
    /** The id StandaloneServices looks the service up by; its toString() is the service's name. */
    export const IClipboardService: { readonly type: IClipboardService }
}

// Ctrl+. and its quick fix list, used by components/studio/editor/code-editor-panel-quick-fix.test.tsx with the real editor.
declare module 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js'

// Monaco's snippet controller, used by lib/monaco/diagram-starter-insert.test.tsx with the real editor.
declare module 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js'
