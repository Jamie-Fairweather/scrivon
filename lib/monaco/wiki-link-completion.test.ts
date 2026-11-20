import type { editor, languages } from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    bindWikiLinkSuggest,
    provideWikiLinkCompletions,
    registerWikiLinkCompletion,
    registerWikiLinkSource,
    wikiLinkTyping,
    type WikiLinkSource,
} from '@/lib/monaco/wiki-link-completion'
import type { FileNode } from '@/lib/workspace/types'
import { buildWikiIndex } from '@/lib/workspace/wiki-link-lookup'

const ROOT = 'C:\\notes'
const file = (path: string): FileNode => ({ kind: 'file', name: path.split('\\').at(-1)!, path: `${ROOT}\\${path}` })
const folder = (path: string, children: FileNode[]): FileNode => ({
    kind: 'directory',
    name: path.split('\\').at(-1)!,
    path: `${ROOT}\\${path}`,
    children,
})

const TREE: FileNode[] = [
    folder('work', [file('work\\Ideas.md'), file('work\\Plan.md'), file('work\\Today.md')]),
    folder('home', [file('home\\Ideas.md')]),
    file('Readme.md'),
    file('chart.mmd'),
]
const index = buildWikiIndex(ROOT, TREE)
const TODAY = `${ROOT}\\work\\Today.md`

function model(text: string) {
    const lines = text.split('\n')
    return { getLineContent: (n: number) => lines[n - 1] ?? '', getValue: () => text }
}

/** The suggestions with the caret at the `|` in `text`, and what the replaced range covers. */
function at(text: string, source: WikiLinkSource = { index, documentPath: TODAY }) {
    const offset = text.indexOf('|')
    const plain = text.slice(0, offset) + text.slice(offset + 1)
    const before = plain.slice(0, offset).split('\n')
    const position = { lineNumber: before.length, column: before.at(-1)!.length + 1 }
    const found = provideWikiLinkCompletions(model(plain), position, source)
    if (!found) return null
    const line = plain.split('\n')[position.lineNumber - 1]!
    return { ...found, replaces: line.slice(found.range.startColumn - 1, found.range.endColumn - 1) }
}

describe('wikiLinkTyping', () => {
    it('reads a note being named after [[, and a heading after [[#', () => {
        expect(wikiLinkTyping('See [[')).toEqual({ kind: 'note', start: 6, query: '' })
        expect(wikiLinkTyping('See [[Pl')).toEqual({ kind: 'note', start: 6, query: 'Pl' })
        expect(wikiLinkTyping('See [[#Int')).toEqual({ kind: 'heading', start: 7, query: 'Int' })
    })

    it('offers nothing after a label’s |, another note’s #, a closed link, an embed or in inline code', () => {
        expect(wikiLinkTyping('[[Plan|la')).toBeNull()
        expect(wikiLinkTyping('[[Plan#Go')).toBeNull()
        expect(wikiLinkTyping('[[Plan]] and')).toBeNull()
        expect(wikiLinkTyping('![[pic')).toBeNull()
        expect(wikiLinkTyping('`code [[')).toBeNull()
        expect(wikiLinkTyping('`code` [[')).toEqual({ kind: 'note', start: 9, query: '' })
        expect(wikiLinkTyping('plain [ text')).toBeNull()
    })
})

describe('provideWikiLinkCompletions', () => {
    it('offers the folder’s notes by name, its own folder first, with the folder shown when names clash', () => {
        const found = at('Go to [[|]]')!
        expect(found.suggestions.map(({ label, description }) => [label, description])).toEqual([
            ['Ideas', 'work'],
            ['Plan', undefined],
            ['Ideas', 'home'],
            ['Readme', undefined],
        ])
    })

    it('inserts the name and the closing ]], over any ]] already there, and a path when the name would lead elsewhere', () => {
        const found = at('Go to [[Pl|]] now')!
        expect(found.replaces).toBe('Pl]]')
        expect(found.suggestions.find((s) => s.label === 'Plan')!.insertText).toBe('Plan]]')
        expect(found.suggestions.filter((s) => s.label === 'Ideas').map((s) => s.insertText)).toEqual(['Ideas]]', 'home/Ideas]]'])
        expect(at('Go to [[Pl|')!.replaces).toBe('Pl')
        expect(at('Go to [[Pl|] x')!.replaces).toBe('Pl]')
    })

    it('offers the file’s own headings after [[#, from the text in the editor', () => {
        const found = at('# Today\n\n## Next steps\n\nSee [[#|]]\n\n```\n# not a heading\n```')!
        expect(found.suggestions.map(({ label, insertText }) => [label, insertText])).toEqual([
            ['Today', 'Today]]'],
            ['Next steps', 'Next steps]]'],
        ])
        expect(found.replaces).toBe(']]')
    })

    it('offers no notes without a folder, but still the headings', () => {
        expect(at('[[|', { index: null, documentPath: null })!.suggestions).toEqual([])
        expect(at('# A\n[[#|', { index: null, documentPath: null })!.suggestions).toHaveLength(1)
    })

    it('offers nothing in a code block or away from a wiki link', () => {
        expect(at('```\n[[|\n```')).toBeNull()
        expect(at('Plain text|')).toBeNull()
    })
})

describe('registerWikiLinkCompletion', () => {
    afterEach(() => registerWikiLinkSource({ index: null, documentPath: null }))

    it('gives Monaco the registered folder’s notes for Markdown files only', () => {
        const register = vi.fn((_language: string, provider: languages.CompletionItemProvider) => {
            void provider
            return { dispose: () => {} }
        })
        registerWikiLinkCompletion({
            languages: { registerCompletionItemProvider: register, CompletionItemKind: { File: 20, Reference: 17 } } as never,
        })
        expect(register).toHaveBeenCalledWith('markdown', expect.anything())
        const provider = register.mock.calls[0]![1]
        const stop = registerWikiLinkSource({ index, documentPath: TODAY })
        const list = provider.provideCompletionItems(
            model('[[') as never,
            { lineNumber: 1, column: 3 } as never,
            {} as never,
            {} as never
        ) as languages.CompletionList
        expect(list.suggestions.map((s) => [s.label, s.kind, s.insertText])).toEqual([
            [{ label: 'Ideas', description: 'work' }, 20, 'Ideas]]'],
            ['Plan', 20, 'Plan]]'],
            [{ label: 'Ideas', description: 'home' }, 20, 'home/Ideas]]'],
            ['Readme', 20, 'Readme]]'],
        ])
        stop()
        const empty = provider.provideCompletionItems(
            model('[[') as never,
            { lineNumber: 1, column: 3 } as never,
            {} as never,
            {} as never
        ) as languages.CompletionList
        expect(empty.suggestions).toEqual([])
    })
})

describe('bindWikiLinkSuggest', () => {
    type Change = { text: string; range: { startLineNumber: number; startColumn: number }; rangeLength: number }

    function editorWith(text: string) {
        let content = text
        let position = { lineNumber: 1, column: 1 }
        const listeners: Record<string, (event?: unknown) => void> = {}
        const fake = {
            onDidChangeModelContent: (listener: (event: unknown) => void) => ((listeners.change = listener as never), { dispose: () => {} }),
            onDidCompositionStart: (listener: () => void) => ((listeners.start = listener), { dispose: () => {} }),
            onDidCompositionEnd: (listener: () => void) => ((listeners.end = listener), { dispose: () => {} }),
            getModel: () => model(content),
            getPosition: () => position,
            trigger: vi.fn(),
        }
        /** Types `typed` at the end of the first line, as Monaco reports it. */
        const type = async (typed: string, extra: Partial<{ isUndoing: boolean; rangeLength: number }> = {}) => {
            const column = content.length + 1
            const change: Change = { text: typed, range: { startLineNumber: 1, startColumn: column }, rangeLength: extra.rangeLength ?? 0 }
            content += typed
            position = { lineNumber: 1, column: column + 1 }
            listeners.change!({ changes: [change], isUndoing: extra.isUndoing ?? false, isRedoing: false, isFlush: false })
            await Promise.resolve()
        }
        return { fake, type, compose: (on: boolean) => listeners[on ? 'start' : 'end']!() }
    }

    it('opens the list when [[ or [[# has just been typed in a Markdown file', async () => {
        const { fake, type } = editorWith('See [')
        bindWikiLinkSuggest(fake as unknown as editor.ICodeEditor, () => true)
        await type('[]')
        expect(fake.trigger).toHaveBeenCalledWith('wiki-links', 'editor.action.triggerSuggest', {})
        fake.trigger.mockClear()
        await type('x')
        expect(fake.trigger).not.toHaveBeenCalled()

        const heading = editorWith('[[')
        bindWikiLinkSuggest(heading.fake as unknown as editor.ICodeEditor, () => true)
        await heading.type('#')
        expect(heading.fake.trigger).toHaveBeenCalledTimes(1)
    })

    it('opens nothing in a diagram file, for a single [, on undo, or while an input method composes', async () => {
        const diagram = editorWith('A[')
        bindWikiLinkSuggest(diagram.fake as unknown as editor.ICodeEditor, () => false)
        await diagram.type('[')

        const single = editorWith('See ')
        bindWikiLinkSuggest(single.fake as unknown as editor.ICodeEditor, () => true)
        await single.type('[')

        const undo = editorWith('See [')
        bindWikiLinkSuggest(undo.fake as unknown as editor.ICodeEditor, () => true)
        await undo.type('[', { isUndoing: true })

        const ime = editorWith('See [')
        bindWikiLinkSuggest(ime.fake as unknown as editor.ICodeEditor, () => true)
        ime.compose(true)
        await ime.type('[')
        ime.compose(false)

        for (const { fake } of [diagram, single, undo, ime]) expect(fake.trigger).not.toHaveBeenCalled()
    })
})
