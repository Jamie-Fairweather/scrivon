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

// Monaco's URI parser, used by lib/monaco/model-keys.test.ts to read model keys the way the editor does.
declare module 'monaco-editor/esm/vs/base/common/uri.js' {
    export { Uri as URI } from 'monaco-editor'
}

// Monaco's opener service, used by lib/monaco/setup-monaco.ts to register the Ctrl+Click link opener
// directly, so it gets the link text as written instead of a parsed (percent-decoded) Uri.
declare module 'monaco-editor/esm/vs/platform/opener/common/opener.js' {
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
declare module 'monaco-editor/esm/vs/editor/browser/config/tabFocus.js' {
    import type { IDisposable } from 'monaco-editor'
    export const TabFocus: {
        getTabFocusMode(): boolean
        setTabFocusMode(tabFocusMode: boolean): void
        onDidChangeTabFocus(listener: (tabFocusMode: boolean) => void): IDisposable
    }
}

// Monaco's shared command registry, used by lib/monaco/editor-keybindings.test.ts to check that
// Scrivon's 'Command Palette' replaces Monaco's own for the editor's right-click menu.
declare module 'monaco-editor/esm/vs/platform/commands/common/commands.js' {
    import type { IDisposable } from 'monaco-editor'
    export const CommandsRegistry: {
        registerCommand(id: string, handler: (accessor: unknown, ...args: unknown[]) => unknown): IDisposable
        getCommand(id: string): { id: string; handler: (accessor: unknown, ...args: unknown[]) => unknown } | undefined
    }
}

declare module 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js' {
    export namespace StandaloneServices {
        function get<T>(serviceId: { readonly type: T }): T
    }
}

// Used by lib/monaco/link-opener.test.ts to check the opener against Monaco's real service.
declare module 'monaco-editor/esm/vs/editor/browser/services/openerService.js' {
    import type { IOpenerService } from 'monaco-editor/esm/vs/platform/opener/common/opener.js'
    export class OpenerService implements IOpenerService {
        constructor(editorService: unknown, commandService: unknown)
        registerOpener: IOpenerService['registerOpener']
        open: IOpenerService['open']
    }
}

// Monaco's keybinding table, used by lib/monaco/editor-keybindings.test.ts to check that the editor's
// right-click 'Command Palette' no longer shows F1 once Scrivon's palette has taken it over.
declare module 'monaco-editor/esm/vs/base/common/keybindings.js' {
    export class Keybinding {
        private readonly _keybindingBrand: undefined
    }
    export function decodeKeybinding(keybinding: number, os: number): Keybinding | null
}

declare module 'monaco-editor/esm/vs/platform/keybinding/common/usLayoutResolvedKeybinding.js' {
    import type { Keybinding } from 'monaco-editor/esm/vs/base/common/keybindings.js'
    export class USLayoutResolvedKeybinding {
        static resolveKeybinding(keybinding: Keybinding, os: number): USLayoutResolvedKeybinding[]
    }
}

declare module 'monaco-editor/esm/vs/platform/contextkey/common/contextkey.js' {
    export class ContextKeyExpression {
        private readonly _contextKeyExpressionBrand: undefined
    }
    export const ContextKeyExpr: {
        has(key: string): ContextKeyExpression
    }
}

declare module 'monaco-editor/esm/vs/platform/keybinding/common/resolvedKeybindingItem.js' {
    import type { ContextKeyExpression } from 'monaco-editor/esm/vs/platform/contextkey/common/contextkey.js'
    import type { USLayoutResolvedKeybinding } from 'monaco-editor/esm/vs/platform/keybinding/common/usLayoutResolvedKeybinding.js'
    export class ResolvedKeybindingItem {
        constructor(
            resolvedKeybinding: USLayoutResolvedKeybinding | undefined,
            command: string | null,
            commandArgs: unknown,
            when: ContextKeyExpression | undefined,
            isDefault: boolean,
            extensionId: string | null,
            isBuiltinExtension: boolean
        )
        readonly command: string | null
    }
}

declare module 'monaco-editor/esm/vs/platform/keybinding/common/keybindingResolver.js' {
    import type { ResolvedKeybindingItem } from 'monaco-editor/esm/vs/platform/keybinding/common/resolvedKeybindingItem.js'
    export class KeybindingResolver {
        constructor(defaults: ResolvedKeybindingItem[], overrides: ResolvedKeybindingItem[], log: (message: string) => void)
        /** The key the editor's menus show next to `commandId`, or null when it has none. */
        lookupPrimaryKeybinding(commandId: string, context: unknown): ResolvedKeybindingItem | null
    }
}
