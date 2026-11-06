// Loads the copy of Monaco that ships with the app, so the editor works offline and no
// code is fetched from a CDN at runtime. Import this only in the browser, before
// @monaco-editor/react creates an editor.
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main.js'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'

// Monaco's background work (link detection, word suggestions) runs in a bundled worker.
// The bundler turns this `new Worker(new URL(...))` into its own worker chunk.
globalThis.MonacoEnvironment = {
    getWorker: () => new Worker(new URL('./editor.worker.ts', import.meta.url), { name: 'editorWorkerService' }),
}

loader.config({ monaco })
