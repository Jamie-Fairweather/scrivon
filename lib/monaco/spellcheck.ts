import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, IPosition, IRange, editor, languages } from 'monaco-editor'
import type { SpellcheckLanguage } from '@/lib/spellcheck/languages'
import type { Misspelling, SpellcheckClient } from '@/lib/spellcheck/spellcheck-client'
import { dictionaryForm } from '@/lib/spellcheck/spellcheck-settings'

/** Whose marks these are, so setting them leaves other marks alone. */
export const SPELLCHECK_MARKER_OWNER = 'scrivon-spelling'
export const ADD_TO_DICTIONARY_COMMAND = 'scrivon.spelling.addToDictionary'
/** How long typing must pause before the text is checked again. */
export const SPELLCHECK_DELAY_MS = 400
/** True while the caret is on a misspelt word: shows the spelling entries in the right-click menu. */
const ON_MISSPELT_WORD_KEY = 'scrivonOnMisspeltWord'
/** More marks than anyone would fix one by one; a file full of another language would otherwise slow the editor. */
const MAX_MARKS = 2000

/** What to check: the file showing (by its model's URI), in which language, and the user's own words. */
export type SpellcheckConfig = { modelUri: string; language: SpellcheckLanguage; words: readonly string[] }

export type SpellcheckSession = IDisposable & {
    /** Null turns the check off for the file showing (a diagram, a read-only file, or spelling switched off). */
    setConfig(config: SpellcheckConfig | null): void
}

type Options = {
    client: SpellcheckClient
    /** Saves a word to the user's dictionary. */
    addWord: (word: string) => void
}

/** A misspelt word in a model, where it was when the model was last checked. */
type Mark = { word: string; range: IRange }

/**
 * Checks the spelling of the file in the editor, in the worker, once typing pauses, and underlines
 * the words the dictionary doesn't know.
 */
export function attachSpellcheck(
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
    { client, addWord }: Options,
    initial: SpellcheckConfig | null
): SpellcheckSession {
    let config = initial
    let timer: ReturnType<typeof setTimeout> | null = null
    const marks = new WeakMap<editor.ITextModel, Mark[]>()
    const onMisspeltWord = editorInstance.createContextKey<boolean>(ON_MISSPELT_WORD_KEY, false)

    const toMarker = ({ word, range }: Mark): editor.IMarkerData => ({
        ...range,
        severity: monaco.MarkerSeverity.Info,
        message: `“${word}” isn't in the dictionary.`,
    })

    /**
     * The misspelt word at a position. Marks stay where the last check put them, so one whose text has
     * changed since (an edit before it on the line, say) counts only once the next check has moved it.
     */
    const markAt = (model: editor.ITextModel, position: IPosition): Mark | undefined =>
        marks
            .get(model)
            ?.find(
                ({ word, range }) =>
                    range.startLineNumber === position.lineNumber &&
                    range.startColumn <= position.column &&
                    position.column <= range.endColumn &&
                    model.getValueInRange(range) === word
            )

    const markAtCaret = (): Mark | undefined => {
        const model = editorInstance.getModel()
        const position = editorInstance.getPosition()
        return model && position ? markAt(model, position) : undefined
    }

    const updateMenu = () => onMisspeltWord.set(markAtCaret() !== undefined)

    const show = (model: editor.ITextModel, found: Mark[]) => {
        marks.set(model, found)
        monaco.editor.setModelMarkers(model, SPELLCHECK_MARKER_OWNER, found.map(toMarker))
        updateMenu()
    }

    /** Saves the word, and takes its marks away now rather than after the next check. */
    const addToDictionary = (word: string) => {
        const added = dictionaryForm(word)
        addWord(added)
        const model = editorInstance.getModel()
        const shown = model ? marks.get(model) : undefined
        if (model && shown)
            show(
                model,
                shown.filter((mark) => dictionaryForm(mark.word) !== added)
            )
    }

    const noActions: languages.CodeActionList = { actions: [], dispose: () => {} }

    const codeActions: languages.CodeActionProvider = {
        async provideCodeActions(model, range, _context, token) {
            const mark = markAt(model, { lineNumber: range.startLineNumber, column: range.startColumn })
            const asked = config
            if (!mark || !asked) return noActions
            const suggestions = await client.suggest(mark.word, asked.language, asked.words).catch(() => [])
            if (token.isCancellationRequested) return noActions
            const diagnostics = [toMarker(mark)]
            const versionId = model.getVersionId()
            const changes = suggestions.map(
                (suggestion, index): languages.CodeAction => ({
                    title: `Change to “${suggestion}”`,
                    kind: 'quickfix',
                    diagnostics,
                    isPreferred: index === 0,
                    edit: { edits: [{ resource: model.uri, versionId, textEdit: { range: mark.range, text: suggestion } }] },
                })
            )
            const addTitle = `Add “${dictionaryForm(mark.word)}” to Dictionary`
            const add: languages.CodeAction = {
                title: addTitle,
                kind: 'quickfix',
                diagnostics,
                command: { id: ADD_TO_DICTIONARY_COMMAND, title: addTitle, arguments: [mark.word] },
            }
            return { actions: [...changes, add], dispose: () => {} }
        },
    }

    const toMarks = (model: editor.ITextModel, misspellings: Misspelling[]): Mark[] =>
        misspellings.slice(0, MAX_MARKS).map(({ word, offset }) => {
            const start = model.getPositionAt(offset)
            const end = model.getPositionAt(offset + word.length)
            return {
                word,
                range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
            }
        })

    const check = () => {
        timer = null
        const model = editorInstance.getModel()
        if (!model) return
        const asked = config
        if (!asked || model.uri.toString() !== asked.modelUri) {
            // Not just when this session marked it: another editor, or one before it, may have.
            show(model, [])
            return
        }
        const version = model.getVersionId()
        client.check(model.getValue(), asked.language, asked.words, asked.modelUri).then(
            (misspellings) => {
                // The text or the settings changed while it was checked: a newer check is on its way.
                if (model.isDisposed() || model.getVersionId() !== version || config !== asked) return
                show(model, toMarks(model, misspellings))
            },
            // The worker couldn't check (it says why once): the text just isn't underlined.
            () => {}
        )
    }

    const schedule = (delay: number) => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(check, delay)
    }

    const subscriptions: IDisposable[] = [
        editorInstance.onDidChangeModelContent(() => schedule(SPELLCHECK_DELAY_MS)),
        // Another tab: check it again, or clear its marks when spell check was turned off while it was hidden.
        editorInstance.onDidChangeModel(() => {
            updateMenu()
            schedule(0)
        }),
        editorInstance.onDidChangeCursorPosition(updateMenu),
        monaco.languages.registerCodeActionProvider('markdown', codeActions, { providedCodeActionKinds: ['quickfix'] }),
        monaco.editor.registerCommand(ADD_TO_DICTIONARY_COMMAND, (_accessor: unknown, word: string) => addToDictionary(word)),
        // Right-clicking a word puts the caret on it first, so these act on the word clicked.
        editorInstance.addAction({
            id: 'scrivon.spelling.suggestions',
            label: 'Spelling Suggestions',
            precondition: ON_MISSPELT_WORD_KEY,
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 0,
            run: (target) => target.getAction('editor.action.quickFix')?.run(),
        }),
        editorInstance.addAction({
            id: 'scrivon.spelling.addToDictionary',
            label: 'Add to Dictionary',
            precondition: ON_MISSPELT_WORD_KEY,
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 0.1,
            run: () => {
                const mark = markAtCaret()
                if (mark) addToDictionary(mark.word)
            },
        }),
    ]
    schedule(0)

    return {
        setConfig(next) {
            config = next
            schedule(0)
        },
        dispose() {
            if (timer !== null) clearTimeout(timer)
            subscriptions.forEach((subscription) => subscription.dispose())
        },
    }
}
