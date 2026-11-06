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
