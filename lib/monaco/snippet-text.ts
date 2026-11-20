import { SnippetParser } from 'monaco-editor/editor/contrib/snippet/browser/snippetParser.js'

/** The text a snippet body puts in the editor before anything is typed over it: placeholders filled in, no `$` markers. */
export function snippetText(body: string): string {
    return new SnippetParser().parse(body).toString()
}
