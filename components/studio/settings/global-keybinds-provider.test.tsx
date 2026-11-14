import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useRegisterCommands } from '@/components/studio/commands/command-registry'
import { buildEditorCommands } from '@/components/studio/editor/editor-commands'
import { GlobalKeybindsProvider } from '@/components/studio/settings/global-keybinds-provider'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

const mocks = vi.hoisted(() => ({
    toggleExplorer: vi.fn(),
    previewOnly: vi.fn(),
    fitDiagram: vi.fn(),
    otherExplorer: vi.fn(),
    toggleEditor: vi.fn(),
    bold: vi.fn(),
    code: vi.fn(),
    openMode: vi.fn(),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ isDesktop: true, workspaceRoot: 'C:/work' }),
}))

vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({
    useCommandPalette: () => ({ openMode: mocks.openMode }),
}))

/** Set once, so the list stays the same between renders as a feature's memoized list does. */
const COMMANDS: AppCommand[] = [
    { id: 'toggle-explorer', label: 'Explorer', keybind: 'view.toggleExplorer', run: mocks.toggleExplorer },
    { id: 'preview-only', label: 'Preview Only', keybind: 'view.previewOnly', run: mocks.previewOnly },
    { id: 'fit-diagram', label: 'Fit Diagram', keybind: 'view.fitDiagram', disabled: true, run: mocks.fitDiagram },
    // A second command on the same keys: the first one registered runs.
    { id: 'other-explorer', label: 'Other', keybind: 'view.toggleExplorer', run: mocks.otherExplorer },
    { id: 'toggle-editor', label: 'Editor', keybind: 'view.toggleEditor', run: mocks.toggleEditor },
    { id: 'edit.bold', label: 'Bold', keybind: 'format.bold', run: mocks.bold },
    // Off, as in a file that isn't Markdown.
    { id: 'edit.inline-code', label: 'Inline Code', keybind: 'format.code', disabled: true, run: mocks.code },
]

function Commands() {
    useRegisterCommands(COMMANDS)
    return null
}

function Providers({ children }: { children: ReactNode }) {
    return (
        <SettingsProvider>
            <CommandRegistryProvider>
                <Commands />
                <GlobalKeybindsProvider>{children}</GlobalKeybindsProvider>
            </CommandRegistryProvider>
        </SettingsProvider>
    )
}

/** Presses the keys and says whether the app took them (the web view never sees them). */
function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body): boolean {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event.defaultPrevented
}

describe('GlobalKeybindsProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('runs the command that has the pressed shortcut', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })

        expect(press('b', { ctrlKey: true, shiftKey: true })).toBe(true)

        expect(mocks.toggleExplorer).toHaveBeenCalledTimes(1)
        expect(mocks.otherExplorer).not.toHaveBeenCalled()
    })

    it('does nothing while the command is greyed out, but still keeps the keys from the web view', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })

        // Ctrl+R would reload the app.
        expect(press('r', { ctrlKey: true })).toBe(true)

        expect(mocks.fitDiagram).not.toHaveBeenCalled()
    })

    it('gives a Markdown command the keys while typing in the editor, and passes them on while it is greyed out', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })
        const editor = document.createElement('div')
        editor.className = 'monaco-editor'
        const text = document.createElement('div')
        text.className = 'native-edit-context'
        editor.appendChild(text)
        document.body.appendChild(editor)

        expect(press('b', { ctrlKey: true }, text)).toBe(true)
        expect(mocks.bold).toHaveBeenCalledTimes(1)

        expect(press('e', { ctrlKey: true }, text)).toBe(true)
        expect(mocks.code).not.toHaveBeenCalled()
        expect(mocks.toggleEditor).toHaveBeenCalledTimes(1)
        editor.remove()
    })

    describe("with the editor's own commands", () => {
        /** The editor's real commands for the file, plus Toggle Editor, which shares Ctrl+E with Inline Code. */
        function renderFor(file: { readOnly: boolean; markdown: boolean }) {
            const runFormat = vi.fn()
            const toggleEditor = vi.fn()
            const commands: AppCommand[] = [
                ...buildEditorCommands({ editor: 'ready', isMac: false, runAction: vi.fn(), runFormat, ...file }),
                { id: 'toggle-editor', label: 'Editor', keybind: 'view.toggleEditor', run: toggleEditor },
            ]
            function FileCommands() {
                useRegisterCommands(commands)
                return null
            }
            renderHook(() => useAppSettings(), {
                wrapper: ({ children }: { children: ReactNode }) => (
                    <SettingsProvider>
                        <CommandRegistryProvider>
                            <FileCommands />
                            <GlobalKeybindsProvider>{children}</GlobalKeybindsProvider>
                        </CommandRegistryProvider>
                    </SettingsProvider>
                ),
            })
            const editor = document.createElement('div')
            editor.className = 'monaco-editor'
            const text = document.createElement('div')
            text.className = 'native-edit-context'
            editor.appendChild(text)
            document.body.appendChild(editor)
            return { text, runFormat, toggleEditor, cleanUp: () => editor.remove() }
        }

        it('takes the format keys in a read-only Markdown file and does nothing, so Ctrl+E never hides the editor', () => {
            const { text, runFormat, toggleEditor, cleanUp } = renderFor({ readOnly: true, markdown: true })

            const taken = ['b', 'i', 'e', 'k'].map((key) => press(key, { ctrlKey: true }, text))

            expect(taken).toEqual([true, true, true, true])
            expect(runFormat).not.toHaveBeenCalled()
            expect(toggleEditor).not.toHaveBeenCalled()
            cleanUp()
        })

        it('still passes Ctrl+E on to Toggle Editor in a read-only file that is not Markdown', () => {
            const { text, toggleEditor, cleanUp } = renderFor({ readOnly: true, markdown: false })

            expect(press('e', { ctrlKey: true }, text)).toBe(true)

            expect(toggleEditor).toHaveBeenCalledTimes(1)
            cleanUp()
        })
    })

    it('leaves keys alone when no command has them', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })

        // Save All's keys, with no Save All command registered.
        expect(press('s', { ctrlKey: true, shiftKey: true })).toBe(false)
    })

    it('opens the palette on its own keys', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })

        press('F1')
        press('f', { ctrlKey: true, shiftKey: true })
        press('n', { ctrlKey: true, shiftKey: true })

        expect(mocks.openMode.mock.calls).toEqual([['all'], ['text'], ['files']])
    })

    it('turns shortcuts off while settings is open, so recording a shortcut does not also run it', () => {
        const { result } = renderHook(() => useAppSettings(), { wrapper: Providers })
        act(() => {
            result.current.openSettings('keyboard')
        })

        press('o', { ctrlKey: true, shiftKey: true })
        press('F1')
        press(',', { ctrlKey: true })

        expect(mocks.previewOnly).not.toHaveBeenCalled()
        expect(mocks.openMode).not.toHaveBeenCalled()
        expect(result.current.activeSection).toBe('keyboard')

        act(() => {
            result.current.closeSettings()
        })
        press('o', { ctrlKey: true, shiftKey: true })

        expect(mocks.previewOnly).toHaveBeenCalledTimes(1)
    })
})
