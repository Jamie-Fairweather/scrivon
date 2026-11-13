import type { Monaco } from '@monaco-editor/react'
import { act, renderHook } from '@testing-library/react'
import type { editor } from 'monaco-editor'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import type { SpellcheckConfig } from '@/lib/monaco/spellcheck'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import type { DocumentTab } from '@/lib/workspace/types'

type Attached = {
    config: SpellcheckConfig | null
    addWord: (word: string) => void
    setConfig: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
}
const attached: Attached[] = []

vi.mock('@/lib/monaco/spellcheck', () => ({
    attachSpellcheck: (_editor: unknown, _monaco: unknown, options: { addWord: (word: string) => void }, config: SpellcheckConfig | null) => {
        const session: Attached = {
            config,
            addWord: options.addWord,
            setConfig: vi.fn((next: SpellcheckConfig | null) => (session.config = next)),
            dispose: vi.fn(),
        }
        attached.push(session)
        return session
    },
}))
vi.mock('@/lib/spellcheck/spellcheck-client', () => ({ getSpellcheckClient: () => ({}) }))

const { useEditorSpellcheck } = await import('./use-editor-spellcheck')

const URI = 'inmemory://scrivon/document-1'

function tab(name: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: name, path: name, name, content: '', isDirty: false, isSaving: false, ...extra }
}

function wrapper({ children }: { children: ReactNode }) {
    return <SettingsProvider>{children}</SettingsProvider>
}

function setup(initialTab: DocumentTab | null) {
    return renderHook(
        ({ activeTab }: { activeTab: DocumentTab | null }) => ({
            attach: useEditorSpellcheck(activeTab, activeTab ? URI : undefined),
            app: useAppSettings(),
        }),
        { wrapper, initialProps: { activeTab: initialTab } }
    )
}

function attach(view: ReturnType<typeof setup>) {
    return view.result.current.attach({} as editor.IStandaloneCodeEditor, {} as Monaco)
}

describe('useEditorSpellcheck', () => {
    beforeEach(() => {
        attached.length = 0
        const store = new Map<string, string>([
            [SETTINGS_STORAGE_KEY, JSON.stringify({ spellcheck: { enabled: true, language: 'en-GB', words: ['Tauri'] } })],
        ])
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => store.set(key, String(value)),
        })
    })

    afterEach(() => vi.unstubAllGlobals())

    it('checks an editable Markdown file in the chosen language, with the user’s words', () => {
        const view = setup(tab('notes.md'))
        attach(view)
        expect(attached[0]!.config).toEqual({ modelUri: URI, language: 'en-GB', words: ['Tauri'] })
    })

    it('leaves diagrams and read-only files alone, and stops when spelling is switched off', () => {
        const view = setup(tab('flow.mmd'))
        attach(view)
        expect(attached[0]!.config).toBeNull()

        view.rerender({ activeTab: tab('example.md', { readOnly: true }) })
        expect(attached[0]!.config).toBeNull()

        view.rerender({ activeTab: tab('notes.md') })
        expect(attached[0]!.config).toMatchObject({ modelUri: URI })

        act(() => view.result.current.app.updateSettings((s) => ({ ...s, spellcheck: { ...s.spellcheck, enabled: false } })))
        expect(attached[0]!.config).toBeNull()
    })

    it('saves an added word to the user’s dictionary and checks with it', () => {
        const view = setup(tab('notes.md'))
        attach(view)
        act(() => attached[0]!.addWord('Scrivon'))
        expect(view.result.current.app.settings.spellcheck.words).toEqual(['Tauri', 'Scrivon'])
        expect(attached[0]!.config).toMatchObject({ words: ['Tauri', 'Scrivon'] })
    })

    it('stops updating a session once it is let go of', () => {
        const view = setup(tab('notes.md'))
        const session = attach(view)
        session.dispose()
        expect(attached[0]!.dispose).toHaveBeenCalled()
        view.rerender({ activeTab: tab('flow.mmd') })
        expect(attached[0]!.setConfig).not.toHaveBeenCalled()
    })
})
