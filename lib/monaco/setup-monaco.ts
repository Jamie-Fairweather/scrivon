// Loads the copy of Monaco that ships with the app, so the editor works offline and no
// code is fetched from a CDN at runtime. Import this only in the browser, before
// @monaco-editor/react creates an editor.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor'
// The editor features the full monaco-editor entry loads (find, folding, the right-click menu, ...),
// without its CSS, HTML, JSON and TypeScript services, which need workers of their own.
import 'monaco-editor/features/register.all'
// The full entry loads these too, but register.all leaves them out: paste handling, the caret moving
// commands and semantic colouring. Every editor had them before Monaco 0.56 split up its entry points.
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js'
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js'
import 'monaco-editor/languages/definitions/markdown/register'
// The languages Markdown code blocks are coloured with.
import '@/lib/monaco/code-block-languages'
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js'
import { IClipboardService } from 'monaco-editor/platform/clipboard/common/clipboardService.js'
import { IOpenerService } from 'monaco-editor/platform/opener/common/opener.js'
import { createMonacoClipboardService } from '@/lib/monaco/clipboard-service'
import { registerExternalLinkOpener } from '@/lib/monaco/link-opener'
import { registerMermaidLanguage } from '@/lib/monaco/mermaid-language'

// Monaco's background work (link detection, word suggestions) runs in a bundled worker.
// The bundler turns this `new Worker(new URL(...))` into its own worker chunk.
globalThis.MonacoEnvironment = {
    getWorker: () => new Worker(new URL('./editor.worker.ts', import.meta.url), { name: 'editorWorkerService' }),
}

loader.config({ monaco })

// The editor's clipboard goes through Tauri, so WebView2 never asks for clipboard access (#208). Monaco only
// takes this the first time it sets its services up, so it comes before anything below asks it for one.
StandaloneServices.initialize({ [String(IClipboardService)]: createMonacoClipboardService() })

// .mmd and .mermaid files, and ```mermaid blocks in Markdown.
registerMermaidLanguage(monaco)

// Ctrl+Clicked web and email links open in the system browser or mail app.
registerExternalLinkOpener(StandaloneServices.get(IOpenerService))
