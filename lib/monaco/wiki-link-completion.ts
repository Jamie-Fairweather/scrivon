import type { IDisposable, IRange, editor, languages } from 'monaco-editor'
import { readOutline } from '@/lib/markdown/document-outline'
import { insideCodeBlock } from '@/lib/markdown/code-blocks'
import { comparablePath } from '@/lib/tauri/fs'
import { wikiNameClashes, wikiTargetFor, type WikiIndex } from '@/lib/workspace/wiki-link-lookup'

/**
 * Suggestions for wiki links in Markdown files: typing `[[` offers the open folder's notes by name, and `[[#` the
 * file's own headings. Markdown tabs have Monaco's own suggestions turned off (code-editor-panel.tsx), so the list
 * only ever opens here, or on Ctrl+Space inside `[[…`.
 */

/** What the editor knows for suggestions: the open folder's notes, and the file being edited. Filled by the workspace. */
export type WikiLinkSource = {
    /** The open folder's notes (wikiIndexFor), or null with no folder open, or for a file outside it. */
    index: WikiIndex | null
    /** The file being edited, so a clash between names is settled from its folder. */
    documentPath: string | null
}

let source: WikiLinkSource = { index: null, documentPath: null }

/** Tells the suggestions which notes there are. Returns the function that takes them away again. */
export function registerWikiLinkSource(next: WikiLinkSource): () => void {
    source = next
    return () => {
        if (source === next) source = { index: null, documentPath: null }
    }
}

/** What the text before the caret is in the middle of: a note's name after `[[`, or a heading after `[[#`. */
export type WikiLinkTyping = {
    kind: 'note' | 'heading'
    /** Where what is typed so far starts on the line (from 0): just after `[[`, or after `[[#`. */
    start: number
    query: string
}

/** Whether `text` ends inside inline code: a run of backticks that no run as long closes. */
function inInlineCode(text: string): boolean {
    let open = false
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] !== '`') continue
        let run = 1
        while (text[i + run] === '`') run += 1
        const close = text.indexOf('`'.repeat(run), i + run)
        if (close < 0) {
            open = true
            break
        }
        i = close + run - 1
    }
    return open
}

/**
 * Whether the text before the caret (on its line) is a wiki link being written, and what of it is typed so far. Not
 * after `|` (the label is the writer's own) or `#` after a name (other notes' headings aren't offered), nor in an embed
 * (`![[`) or inline code.
 */
export function wikiLinkTyping(before: string): WikiLinkTyping | null {
    const open = before.lastIndexOf('[[')
    if (open < 0 || before[open - 1] === '!') return null
    const typed = before.slice(open + 2)
    if (/[[\]|]/.test(typed) || inInlineCode(before.slice(0, open))) return null
    if (typed.startsWith('#')) return { kind: 'heading', start: open + 3, query: typed.slice(1) }
    if (typed.includes('#')) return null
    return { kind: 'note', start: open + 2, query: typed }
}

/** One suggestion, before it is given to Monaco. */
export type WikiLinkSuggestion = {
    label: string
    /** The folder, when another note has the same name. */
    description?: string
    detail?: string
    /** What replaces what is typed so far (and the rest of the name after the caret), with `]]` when it closes the link. */
    insertText: string
    sortText: string
}

/**
 * What a wiki link can't name, as nothing can be escaped inside one (see parseWikiLinkText): a note whose name or path
 * has a bracket, `|` or `#` in it (`C# tips` would be read as `C` and its heading `tips`), or a heading with a bracket
 * or `|` (a `#` after the first is still part of the heading). Those are left out of the list.
 */
const UNLINKABLE_TARGET = /[[\]|#]/
const UNLINKABLE_HEADING = /[[\]|]/

/**
 * The notes to offer: every note in the open folder but the file itself, those in its own folder first. Not one a
 * wiki link can't name (UNLINKABLE_TARGET).
 */
export function noteSuggestions({ index, documentPath }: WikiLinkSource): WikiLinkSuggestion[] {
    if (!index) return []
    const own = documentPath ? comparablePath(documentPath) : null
    const notes = index.notes.filter((note) => comparablePath(note.path) !== own)
    // A file the tree doesn't list (or none) counts as at the top, as the lookup counts it.
    const ownFolder = (index.notes.find((note) => comparablePath(note.path) === own)?.folder ?? '').toLowerCase()
    return notes
        .map((note) => ({ note, target: wikiTargetFor(index, note, documentPath), near: note.folder.toLowerCase() === ownFolder ? 0 : 1 }))
        .filter(({ target }) => !UNLINKABLE_TARGET.test(target))
        .sort((a, b) => a.near - b.near || a.note.relative.localeCompare(b.note.relative))
        .map(({ note, target }, order) => ({
            label: note.name,
            ...(wikiNameClashes(index, note) ? { description: note.folder || 'top of the folder' } : {}),
            detail: note.relative,
            insertText: `${target}]]`,
            sortText: String(order).padStart(6, '0'),
        }))
}

/** The file's own headings, from the text in the editor. Not one a wiki link can't name (UNLINKABLE_HEADING). */
export function headingSuggestions(text: string): WikiLinkSuggestion[] {
    return readOutline(text)
        .filter((heading) => !UNLINKABLE_HEADING.test(heading.text))
        .map((heading, order) => ({
            label: heading.text,
            detail: `Heading ${heading.level}`,
            insertText: `${heading.text}]]`,
            sortText: String(order).padStart(6, '0'),
        }))
}

/**
 * What of the text after the caret a suggestion replaces, and whether it should still close the link with `]]`. In a
 * link that is already written (Ctrl+Space in `[[Fo|o#Heading]]`), the rest of the name is replaced too. Before `#`
 * or `|` the link goes on, so no `]]` is added; before `]` or `]]` (Monaco closes `[` with `]` as it is typed), those
 * are replaced along with the name, closing `]]` and all. With neither after it, the link is still being written:
 * only what is before the caret is replaced, and `]]` closes it.
 */
function restOfLink(after: string): { length: number; close: boolean } {
    const rest = /^([^[\]|#]*)(\]{1,2}|\||#)?/.exec(after)!
    const name = rest[1]!.length
    const next = rest[2]
    if (next === '|' || next === '#') return { length: name, close: false }
    if (next) return { length: name + next.length, close: true }
    return { length: 0, close: true }
}

/** The suggestions at a place in a Markdown model, with the range each replaces. */
export function provideWikiLinkCompletions(
    model: Pick<editor.ITextModel, 'getLineContent' | 'getValue'>,
    position: { lineNumber: number; column: number },
    current: WikiLinkSource = source
): { suggestions: WikiLinkSuggestion[]; range: IRange } | null {
    const line = model.getLineContent(position.lineNumber)
    const typing = wikiLinkTyping(line.slice(0, position.column - 1))
    if (!typing) return null
    if (insideCodeBlock((index) => model.getLineContent(index + 1), position.lineNumber - 1)) return null
    const rest = restOfLink(line.slice(position.column - 1))
    const range: IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: typing.start + 1,
        endColumn: position.column + rest.length,
    }
    const offered = typing.kind === 'heading' ? headingSuggestions(model.getValue()) : noteSuggestions(current)
    const suggestions = rest.close ? offered : offered.map((suggestion) => ({ ...suggestion, insertText: suggestion.insertText.slice(0, -2) }))
    return { suggestions, range }
}

type CompletionMonaco = { languages: Pick<typeof languages, 'registerCompletionItemProvider' | 'CompletionItemKind'> }

/** Registers the suggestions for Markdown files. Once, when Monaco is set up (setup-monaco.ts). */
export function registerWikiLinkCompletion(monaco: CompletionMonaco): IDisposable {
    return monaco.languages.registerCompletionItemProvider('markdown', {
        provideCompletionItems(model, position) {
            const found = provideWikiLinkCompletions(model, position)
            if (!found) return { suggestions: [] }
            return {
                suggestions: found.suggestions.map((suggestion) => ({
                    label: suggestion.description ? { label: suggestion.label, description: suggestion.description } : suggestion.label,
                    kind: suggestion.detail?.startsWith('Heading')
                        ? monaco.languages.CompletionItemKind.Reference
                        : monaco.languages.CompletionItemKind.File,
                    detail: suggestion.detail,
                    insertText: suggestion.insertText,
                    filterText: suggestion.label,
                    sortText: suggestion.sortText,
                    range: found.range,
                })),
            }
        },
    })
}

type SuggestEditor = Pick<
    editor.ICodeEditor,
    'onDidChangeModelContent' | 'onDidCompositionStart' | 'onDidCompositionEnd' | 'getModel' | 'getPosition' | 'trigger'
>

/** What typing one key puts in: `[` (or `[]`, when Monaco closes the bracket) or `#`. */
const TYPED = new Set(['[', '[]', '#'])

/**
 * Opens the suggestions when `[[` or `[[#` has just been typed in a Markdown file: Monaco's own opening as you type
 * is off there, so prose never gets a list in its way. Not while an input method is composing, so it never
 * interrupts one, nor for pasted text, undo or redo. Lasts as long as the editor.
 */
export function bindWikiLinkSuggest(codeEditor: SuggestEditor, isMarkdown: () => boolean): IDisposable {
    let composing = false
    const subscriptions = [
        codeEditor.onDidCompositionStart(() => {
            composing = true
        }),
        codeEditor.onDidCompositionEnd(() => {
            composing = false
        }),
        codeEditor.onDidChangeModelContent((event) => {
            if (composing || event.isUndoing || event.isRedoing || event.isFlush || event.changes.length !== 1) return
            const [change] = event.changes
            if (!change || change.rangeLength !== 0 || !TYPED.has(change.text) || !isMarkdown()) return
            const opened = change.text === '#' ? '[[#' : '[['
            // The caret moves just after the content does, so the list is opened once it has.
            queueMicrotask(() => {
                const model = codeEditor.getModel()
                const position = codeEditor.getPosition()
                if (composing || !model || !position || position.lineNumber !== change.range.startLineNumber) return
                if (position.column !== change.range.startColumn + 1) return
                if (
                    !model
                        .getLineContent(position.lineNumber)
                        .slice(0, position.column - 1)
                        .endsWith(opened)
                )
                    return
                // Opened on request, an empty list would say "No suggestions." over the prose: so it isn't opened.
                if (!provideWikiLinkCompletions(model, position)?.suggestions.length) return
                codeEditor.trigger('wiki-links', 'editor.action.triggerSuggest', {})
            })
        }),
    ]
    return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) }
}
