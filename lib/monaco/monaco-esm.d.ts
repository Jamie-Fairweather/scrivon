// Monaco's ESM entry points used by setup-monaco.ts ship without type declarations.
declare module 'monaco-editor/esm/vs/editor/edcore.main.js' {
    export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/editor/editor.worker.js'
