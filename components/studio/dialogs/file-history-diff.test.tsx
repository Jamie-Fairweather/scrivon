import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A text in the fake Monaco: disposing it while a diff editor still shows it is what Monaco reports as a bug. */
type FakeModel = { name: string; disposed: boolean; isDisposed: () => boolean; dispose: () => void }
type FakeDiffEditor = {
    model: { original: FakeModel; modified: FakeModel } | null
    disposed: boolean
    getModel: () => { original: FakeModel; modified: FakeModel } | null
    setModel: (model: { original: FakeModel; modified: FakeModel } | null) => void
    dispose: () => void
}

const fake = vi.hoisted(() => ({
    props: null as Record<string, unknown> | null,
    editors: [] as unknown[],
    /** What Monaco would report through onUnexpectedError. */
    bugs: [] as string[],
    /** The order things happened in. */
    log: [] as string[],
    theme: { isLight: true, tokens: { bg: '#ffffff' } as Record<string, string> },
    monaco: { editor: { setTheme: (() => undefined) as (id: string) => void } },
}))

vi.mock('next/dynamic', () => ({
    // The diff editor stand-in is drawn straight away, without loading Monaco.
    default: () => (props: Record<string, unknown>) => <FakeMonacoDiffEditor {...props} />,
}))

vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => fake.theme }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { editor: { fontSize: 15, lineNumbers: 'off' } } }),
}))
vi.mock('@/lib/theme/monaco-theme', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/theme/monaco-theme')>()),
    defineMonacoDiagramTheme: vi.fn(),
}))

function fakeModel(name: string, shownBy: () => FakeDiffEditor | undefined): FakeModel {
    const model: FakeModel = {
        name,
        disposed: false,
        isDisposed: () => model.disposed,
        dispose: () => {
            const editor = shownBy()
            if (editor && !editor.disposed && (editor.model?.original === model || editor.model?.modified === model)) {
                fake.bugs.push('TextModel got disposed before DiffEditorWidget model got reset')
            }
            fake.log.push(`dispose ${name}`)
            model.disposed = true
        },
    }
    return model
}

function fakeDiffEditor(): FakeDiffEditor {
    const editor: FakeDiffEditor = {
        model: null,
        disposed: false,
        getModel: () => (editor.disposed ? null : editor.model),
        setModel: (model) => {
            fake.log.push(model ? 'setModel' : 'setModel(null)')
            editor.model = model
        },
        dispose: () => {
            fake.log.push('dispose editor')
            editor.disposed = true
        },
    }
    editor.model = { original: fakeModel('original', () => editor), modified: fakeModel('modified', () => editor) }
    return editor
}

/** Does what @monaco-editor/react 4.7's DiffEditor does when it mounts and unmounts. */
function FakeMonacoDiffEditor(props: Record<string, unknown>) {
    useEffect(() => {
        fake.props = props
    })
    useEffect(() => {
        const editor = fakeDiffEditor()
        fake.editors.push(editor)
        ;(props.beforeMount as (monaco: unknown) => void)(fake.monaco)
        ;(props.onMount as (editor: unknown, monaco: unknown) => void)(editor, fake.monaco)
        return () => {
            const model = editor.getModel()
            if (!props.keepCurrentOriginalModel) model?.original.dispose()
            if (!props.keepCurrentModifiedModel) model?.modified.dispose()
            editor.dispose()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the library does
    }, [])
    return <div data-testid="diff-editor" />
}

const { FileHistoryDiff, releaseDiffModels } = await import('./file-history-diff')
const { defineMonacoDiagramTheme, MONACO_DIAGRAM_THEME_ID } = await import('@/lib/theme/monaco-theme')

function renderDiff(fileName = 'notes.md') {
    return render(
        <FileHistoryDiff
            fileName={fileName}
            original="kept"
            modified="now"
            originalLabel="Version from 19 Nov 2026, 14:30, read-only"
            modifiedLabel="Text in the editor now, read-only"
        />
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    fake.props = null
    fake.editors = []
    fake.bugs = []
    fake.log = []
    fake.theme = { isLight: true, tokens: { bg: '#ffffff' } }
    fake.monaco.editor.setTheme = vi.fn()
})

describe('FileHistoryDiff', () => {
    it('is a read-only comparison, with a name for each side and the app’s editor settings', () => {
        renderDiff()
        const props = fake.props!
        expect(props).toMatchObject({ original: 'kept', modified: 'now', language: 'markdown', theme: MONACO_DIAGRAM_THEME_ID })
        expect(props.options).toMatchObject({
            readOnly: true,
            domReadOnly: true,
            originalEditable: false,
            originalAriaLabel: 'Version from 19 Nov 2026, 14:30, read-only',
            modifiedAriaLabel: 'Text in the editor now, read-only',
            fontSize: 15,
            lineNumbers: 'off',
        })
    })

    it('colours a Mermaid file as Mermaid', () => {
        renderDiff('flow.mmd')
        expect(fake.props!.language).toBe('mermaid')
    })

    it('starts in the app’s theme and follows it from light to dark', () => {
        const { rerender } = renderDiff()
        expect(defineMonacoDiagramTheme).toHaveBeenCalledWith(fake.monaco, { bg: '#ffffff' }, true)

        fake.theme = { isLight: false, tokens: { bg: '#101010' } }
        rerender(<FileHistoryDiff fileName="notes.md" original="kept" modified="now" originalLabel="a" modifiedLabel="b" />)

        expect(defineMonacoDiagramTheme).toHaveBeenLastCalledWith(fake.monaco, { bg: '#101010' }, false)
        expect(fake.monaco.editor.setTheme).toHaveBeenLastCalledWith(MONACO_DIAGRAM_THEME_ID)
    })

    it('takes its texts out of the diff editor before they are disposed, so Monaco reports no bug when it closes', () => {
        const { unmount } = renderDiff()
        expect(fake.props).toMatchObject({ keepCurrentOriginalModel: true, keepCurrentModifiedModel: true })

        unmount()

        expect(fake.bugs).toEqual([])
        expect(fake.log).toEqual(['setModel(null)', 'dispose original', 'dispose modified', 'dispose editor'])
    })
})

describe('releaseDiffModels', () => {
    it('still disposes the texts when the editor was disposed first', () => {
        const editor = fakeDiffEditor()
        const models = editor.model
        editor.dispose()

        releaseDiffModels(editor as never, models as never)

        expect(fake.bugs).toEqual([])
        expect(models!.original.disposed && models!.modified.disposed).toBe(true)
    })
})
