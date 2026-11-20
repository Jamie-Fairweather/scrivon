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

/** The suggestions with the caret at the `caret` in `text`, and what the replaced range covers. */
function at(text: string, source: WikiLinkSource = { index, documentPath: TODAY }, caret = '|') {
    const offset = text.indexOf(caret)
    const plain = text.slice(0, offset) + text.slice(offset + caret.length)
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

    it('replaces the rest of a name already written, closing the link only where it isn’t closed yet', () => {
        // The caret is at ‸, as these links have a | of their own.
        const plan = (text: string) => {
            const found = at(text, undefined, '‸')!
            return { replaces: found.replaces, insertText: found.suggestions.find((s) => s.label === 'Plan')!.insertText }
        }
        // Ctrl+Space inside a link that has its label, heading or closing brackets already.
        expect(plan('x [[Pl‸|label]] y')).toEqual({ replaces: 'Pl', insertText: 'Plan' })
        expect(plan('x [[P‸l|label]] y')).toEqual({ replaces: 'Pl', insertText: 'Plan' })
        expect(plan('x [[Pl‸#Setup]] y')).toEqual({ replaces: 'Pl', insertText: 'Plan' })
        expect(plan('x [[P‸lx]] y')).toEqual({ replaces: 'Plx]]', insertText: 'Plan]]' })
        // Still being written: what follows isn't part of it.
        expect(plan('x [[P‸ and [[Today]]')).toEqual({ replaces: 'P', insertText: 'Plan]]' })
        expect(plan('x [[P‸lan and more')).toEqual({ replaces: 'P', insertText: 'Plan]]' })

        const heading = at('## Set up\n\n[[#Se‸t|here]]', undefined, '‸')!
        expect(heading.replaces).toBe('Set')
        expect(heading.suggestions.map((s) => s.insertText)).toEqual(['Set up'])
    })

    it('leaves out notes and headings a wiki link can’t name', () => {
        const odd = buildWikiIndex(ROOT, [
            file('C# tips.md'),
            file('Draft [v2].md'),
            file('A | B.md'),
            folder('C#', [file('C#\\Inside.md')]),
            folder('C#2', [file('C#2\\Plain.md')]),
            file('Plain.md'),
        ])
        // `Inside` alone leads to its note; C#2's Plain would need its path, which has a # in it.
        expect(at('[[|', { index: odd, documentPath: null })!.suggestions.map((s) => s.insertText)).toEqual(['Plain]]', 'Inside]]'])
        const headings = at('## A | B\n## [x] done\n## C# tips\n\n[[#‸', undefined, '‸')!
        expect(headings.suggestions.map((s) => s.insertText)).toEqual(['C# tips]]'])
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

    afterEach(() => registerWikiLinkSource({ index: null, documentPath: null }))

    /** An editor whose first line is `text`, with `below` under it. */
    function editorWith(text: string, below = '') {
        let content = text
        let position = { lineNumber: 1, column: 1 }
        const listeners: Record<string, (event?: unknown) => void> = {}
        const fake = {
            onDidChangeModelContent: (listener: (event: unknown) => void) => ((listeners.change = listener as never), { dispose: () => {} }),
            onDidCompositionStart: (listener: () => void) => ((listeners.start = listener), { dispose: () => {} }),
            onDidCompositionEnd: (listener: () => void) => ((listeners.end = listener), { dispose: () => {} }),
            getModel: () => model(content + below),
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
        registerWikiLinkSource({ index, documentPath: TODAY })
        const { fake, type } = editorWith('See [')
        bindWikiLinkSuggest(fake as unknown as editor.ICodeEditor, () => true)
        await type('[]')
        expect(fake.trigger).toHaveBeenCalledWith('wiki-links', 'editor.action.triggerSuggest', {})
        fake.trigger.mockClear()
        await type('x')
        expect(fake.trigger).not.toHaveBeenCalled()

        const heading = editorWith('[[', '\n\n## Next')
        bindWikiLinkSuggest(heading.fake as unknown as editor.ICodeEditor, () => true)
        await heading.type('#')
        expect(heading.fake.trigger).toHaveBeenCalledTimes(1)
    })

    it('opens the list only in the editor typed in, when both editor groups show the file', async () => {
        registerWikiLinkSource({ index, documentPath: TODAY })
        const typedIn = editorWith('See [')
        const other = editorWith('See [')
        bindWikiLinkSuggest({ ...typedIn.fake, hasTextFocus: () => true } as unknown as editor.ICodeEditor, () => true)
        const otherFake = { ...other.fake, hasTextFocus: () => false }
        bindWikiLinkSuggest(otherFake as unknown as editor.ICodeEditor, () => true)
        await typedIn.type('[]')
        await other.type('[]')
        expect(typedIn.fake.trigger).toHaveBeenCalledTimes(1)
        expect(other.fake.trigger).not.toHaveBeenCalled()
    })

    it('gives each editor the notes and folder of its own file', () => {
        const left = registerWikiLinkSource({ index, documentPath: TODAY, modelUri: 'inmemory://scrivon/document-1' })
        const right = registerWikiLinkSource({ index: null, documentPath: null, modelUri: 'inmemory://scrivon/document-2' })
        const at = (uri: string) =>
            provideWikiLinkCompletions(
                { getLineContent: () => '[[', getValue: () => '[[', uri: { toString: () => uri } },
                { lineNumber: 1, column: 3 }
            )
        expect(at('inmemory://scrivon/document-1')?.suggestions.length).toBeGreaterThan(0)
        expect(at('inmemory://scrivon/document-2')?.suggestions ?? []).toEqual([])
        right()
        left()
    })

    it('opens nothing when there is nothing to offer, so no “No suggestions.” box covers the prose', async () => {
        // No folder open: an example, a file on its own, an untitled tab.
        const noFolder = editorWith('See [')
        bindWikiLinkSuggest(noFolder.fake as unknown as editor.ICodeEditor, () => true)
        await noFolder.type('[]')

        // The only note in its folder.
        registerWikiLinkSource({ index: buildWikiIndex(ROOT, [file('Only.md')]), documentPath: `${ROOT}\\Only.md` })
        const alone = editorWith('See [')
        bindWikiLinkSuggest(alone.fake as unknown as editor.ICodeEditor, () => true)
        await alone.type('[]')

        // [[# in a file with no headings.
        const noHeadings = editorWith('[[', '\n\nJust prose.')
        bindWikiLinkSuggest(noHeadings.fake as unknown as editor.ICodeEditor, () => true)
        await noHeadings.type('#')

        for (const { fake } of [noFolder, alone, noHeadings]) expect(fake.trigger).not.toHaveBeenCalled()
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
