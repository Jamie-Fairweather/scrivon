'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import { focusedEditorGroupId } from '@/components/studio/workspace/focused-editor-group'
import { EMPTY_MODEL_KEYS, isModelKey, normalizeEditorText, samePaths, syncModelKeys, type ModelKeyState } from '@/lib/monaco/model-keys'
import { lineEndingsOf } from '@/lib/workspace/text-stats'
import { applyTextEdits, type TextEdit } from '@/lib/workspace/text-edits'
import type { DocumentTab } from '@/lib/workspace/types'

/** How many of the editors' own edits are remembered for each tab while waiting for the tab to show them. */
const MAX_UNSEEN_EDITS = 20

/**
 * An editor panel, one per editor group, as the shared models see it. Read through functions, so they are always
 * current: the editor comes and goes (no file open), and so does the tab it shows.
 */
export type EditorPanelHandle = {
    groupId: string
    /** The panel's Monaco editor, while it has one. */
    editor: () => editor.IStandaloneCodeEditor | null
    /** The tab the panel shows. */
    tabId: () => string | null
    /** Puts the tab's text into the panel's buffer when they disagree (or the given text, see replaceEditorText). */
    sync: (given?: { content: string }) => void
    /** Jumps to a search hit, a heading or a diagram part in the file (now, or once the file shows). */
    reveal: (path: string, line: number, column: number, length?: number) => void
    /** The text selected in the panel's editor, while it shows; null otherwise. */
    selectedText: () => string | null
}

export type EditorModels = {
    /** Each open tab's model key (lib/monaco/model-keys.ts), the same in every group, so both views share a buffer. */
    keys: ModelKeyState
    /** Monaco, once an editor has loaded it. */
    getMonaco: () => Monaco | null
    /** Called by each editor as Monaco loads. */
    setMonaco: (monaco: Monaco) => void
    /** While the app changes a buffer itself, so no editor passes the change on as typing. */
    isSilent: () => boolean
    /**
     * An editor's buffer changed (typing, or an edit the app made in a buffer on screen). Every editor showing that
     * buffer hears it; the tab is updated once, so one keystroke schedules one save and one copy.
     */
    editorChanged: (tabId: string, text: string, model: editor.ITextModel | null, versionId?: number) => void
    /** Puts the tab's text into a buffer that disagrees with it (the tab wins), keeping line endings straight. */
    syncModel: (model: editor.ITextModel, content: string) => void
    /**
     * A tab's latest text: the tab list's own record, which takes each edit at once. A panel's copy of the tab is
     * as the screen last drew it, which can miss a key just typed in the other group's editor on the same buffer.
     */
    latestContent: (tab: DocumentTab) => string
    /** Adds a panel. Returns the function that removes it again. */
    registerPanel: (panel: EditorPanelHandle) => () => void
}

const EditorModelsContext = createContext<EditorModels | null>(null)

/**
 * Uses the Tab size setting in every file, but keeps each file's own choice of tabs or spaces:
 * a file indented with tabs keeps getting tabs, so Tab and Enter don't mix the two.
 */
export function applyIndentation(model: editor.ITextModel, tabSize: number) {
    model.detectIndentation(true, tabSize)
    model.updateOptions({ tabSize, indentSize: tabSize })
}

/**
 * Owns the Monaco buffers (models) of the open tabs, for every editor group at once. Each tab has one buffer, with
 * one undo history, whichever groups show it: typing in one group shows in the other straight away. Buffers of
 * tabs that close are freed here, not by the editors, so closing a group never takes a buffer the other group shows.
 * Also answers the coordinator's edits to a tab's text (applyTabEdits, replaceEditorText) and the jumps into the
 * editor (revealInEditor), which go to the focused group's editor.
 */
export function EditorModelsProvider({ children }: { children: ReactNode }) {
    const { tabs, updateTabContent } = useDocumentTabs()
    const coordinator = useWorkspaceCoordinator()
    const { settings } = useAppSettings()

    // Each open tab gets its own Monaco model; see lib/monaco/model-keys.ts.
    const tabPaths = useMemo(() => tabs.map((t) => t.path), [tabs])
    const [modelKeys, setModelKeys] = useState(() => syncModelKeys(EMPTY_MODEL_KEYS, tabPaths))
    if (!samePaths(modelKeys.paths, tabPaths)) {
        setModelKeys(syncModelKeys(modelKeys, tabPaths))
    }
    // For applyTabEdits, which can be asked to change any open tab.
    const modelKeysRef = useRef(modelKeys)
    const tabsRef = useRef(tabs)
    useEffect(() => {
        modelKeysRef.current = modelKeys
        tabsRef.current = tabs
    }, [modelKeys, tabs])

    const tabSizeRef = useRef(settings.editor.tabSize)
    useEffect(() => {
        tabSizeRef.current = settings.editor.tabSize
    }, [settings.editor.tabSize])

    const monacoRef = useRef<Monaco | null>(null)
    const silentRef = useRef(false)
    const isSilent = useCallback(() => silentRef.current, [])
    const runSilently = useCallback((change: () => void) => {
        silentRef.current = true
        try {
            change()
        } finally {
            silentRef.current = false
        }
    }, [])

    const panelsRef = useRef<EditorPanelHandle[]>([])
    const registerPanel = useCallback((panel: EditorPanelHandle) => {
        panelsRef.current = [...panelsRef.current, panel]
        return () => {
            panelsRef.current = panelsRef.current.filter((p) => p !== panel)
        }
    }, [])
    /** The focused group's panel, else the one added last. */
    const focusedPanel = useCallback((): EditorPanelHandle | undefined => {
        const id = focusedEditorGroupId()
        return panelsRef.current.findLast((p) => p.groupId === id) ?? panelsRef.current.at(-1)
    }, [])

    // Text each tab's editors have sent it that the tab may not show yet.
    const unseenRef = useRef(new Map<string, string[]>())
    // The buffer version each buffer last passed on, so a change every editor on it hears is passed on once.
    const passedOnRef = useRef(new WeakMap<object, number>())
    const editorChanged = useCallback(
        (tabId: string, text: string, model: editor.ITextModel | null, versionId?: number) => {
            if (silentRef.current) return
            if (model && versionId !== undefined) {
                if (passedOnRef.current.get(model) === versionId) return
                passedOnRef.current.set(model, versionId)
            }
            const unseen = unseenRef.current.get(tabId)
            if (!unseen) unseenRef.current.set(tabId, [text])
            else if (unseen.push(text) > MAX_UNSEEN_EDITS) unseen.shift()
            updateTabContent(tabId, text)
        },
        [updateTabContent]
    )

    /**
     * Safety net: if a buffer disagrees with its tab's text, the tab wins. The same text with other line endings
     * (another program changed only those) takes them on as an undo step of its own.
     */
    const syncModel = useCallback(
        (model: editor.ITextModel, content: string) => {
            const monaco = monacoRef.current
            if (!monaco) return
            if (model.getValue(monaco.editor.EndOfLinePreference.LF) === normalizeEditorText(content)) {
                // The same text, but another program may have changed only its line endings (the file was
                // reloaded). Take them on, or the next keystroke would save the old ones over every line.
                // The change goes on the undo stack as its own step, as VS Code does: Ctrl+Z first puts the
                // old line endings back, then undoes earlier edits. Don't use setEOL: it skips the undo
                // stack, so undoing an earlier edit would land in the wrong place and garble the text.
                // Monaco gives a buffer one line ending, so a file that mixes them is evened out on purpose and left that way.
                const endings = lineEndingsOf(content)
                if (endings === null || endings === 'mixed') return
                const eol = endings === 'CRLF' ? '\r\n' : '\n'
                if (model.getEOL() === eol) return
                runSilently(() => {
                    model.pushStackElement()
                    model.pushEOL(eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
                    model.pushStackElement()
                })
                return
            }
            runSilently(() => model.setValue(content))
            applyIndentation(model, tabSizeRef.current)
        },
        [runSilently]
    )

    const latestContent = useCallback(
        (tab: DocumentTab) => coordinator.getTabs.current().find((t) => t.id === tab.id)?.content ?? tab.content,
        [coordinator]
    )

    // The tab's text can also change without the editor while the buffer stays the same: a folder reopened in one
    // go, or a tab list that looked like a rename but wasn't. Anything other than the editors' own edits coming back
    // puts the tab's text into its buffer, once for each tab however many groups show it, so the next keystroke
    // can't save the old buffer over it. Edits the tab hasn't shown yet are kept.
    const lookedAtRef = useRef(new Map<string, string>())
    useEffect(() => {
        const done = new Set<string>()
        for (const panel of panelsRef.current) {
            const id = panel.tabId()
            if (id === null || done.has(id)) continue
            done.add(id)
            const tab = tabs.find((t) => t.id === id)
            if (!tab || lookedAtRef.current.get(id) === tab.content) continue
            lookedAtRef.current.set(id, tab.content)
            const unseen = unseenRef.current.get(id)
            const seen = unseen ? unseen.lastIndexOf(tab.content) : -1
            if (unseen && seen !== -1) {
                unseen.splice(0, seen + 1)
                continue
            }
            unseenRef.current.delete(id)
            panel.sync()
        }
        // Forget what closed tabs showed.
        for (const id of lookedAtRef.current.keys()) if (!tabs.some((t) => t.id === id)) lookedAtRef.current.delete(id)
        for (const id of unseenRef.current.keys()) if (!tabs.some((t) => t.id === id)) unseenRef.current.delete(id)
    }, [tabs])

    // Text a tab gets from disk (a reload) goes into its buffer at once, not when the screen next draws: a key
    // pressed in between would otherwise edit the old text, and saving that would replace the file's new version
    // without asking. Only a tab on screen can be typed in; one in the background catches up when shown.
    const replaceEditorText = useCallback((tabId: string, text: string) => {
        const panel = panelsRef.current.find((p) => p.tabId() === tabId && p.editor()?.getModel())
        if (!panel) return
        // Whatever the editors sent before is based on the old text.
        unseenRef.current.delete(tabId)
        // Put in exactly as the tab's text is when the screen draws, so the two ways can't differ. The buffer is
        // shared, so one panel showing the tab is enough.
        panel.sync({ content: text })
    }, [])

    /**
     * The tab's buffer when it is the one to edit, and an editor showing it (the focused group's first), if one
     * does; null when the tab's text is the one to edit.
     */
    const editableBuffer = useCallback((tab: DocumentTab) => {
        const monaco = monacoRef.current
        const key = modelKeysRef.current.keys.get(tab.path)
        const model = monaco && key ? monaco.editor.getModel(monaco.Uri.parse(key)) : null
        if (!monaco || !model) return null
        const showing = panelsRef.current.filter((p) => p.tabId() === tab.id && p.editor()?.getModel() === model)
        const focusedId = focusedEditorGroupId()
        const panel = showing.find((p) => p.groupId === focusedId) ?? showing[0]
        const shown = panel?.editor() ?? null
        // A background tab's buffer doesn't follow text the tab gets from elsewhere (a reload from disk); it
        // catches up when the tab is shown (sync). Until then the tab's text is the one to edit, and the
        // buffer's undo history is of text the tab no longer has. A buffer on screen is kept up to date straight
        // away, so it is always the one to edit.
        const current = shown !== null || model.getValue(monaco.editor.EndOfLinePreference.LF) === normalizeEditorText(tab.content)
        return current ? { model, editor: shown } : null
    }, [])

    const hasTabBuffer = useCallback(
        (tabId: string): boolean => {
            const tab = tabsRef.current.find((t) => t.id === tabId)
            return tab !== undefined && editableBuffer(tab) !== null
        },
        [editableBuffer]
    )

    /**
     * Edits any open tab as one undo step, never with setValue, which would wipe its undo history. A tab on screen
     * (in either group) is edited in its buffer, and its editors pass the new text on as typing does. A tab in the
     * background is edited in its own buffer, which then holds the same text as the tab, so showing it again leaves
     * the buffer and its undo history as they are. A tab the editor hasn't shown has no buffer yet, and a background
     * tab whose buffer is out of date has the wrong one: both get the edited text straight away.
     */
    const applyTabEdits = useCallback(
        (tabId: string, edits: readonly TextEdit[]): boolean => {
            const tab = tabsRef.current.find((t) => t.id === tabId)
            if (!tab || tab.readOnly) return false
            if (edits.length === 0) return true
            const buffer = editableBuffer(tab)
            if (!buffer) {
                updateTabContent(tabId, applyTextEdits(tab.content, edits))
                return true
            }
            const { model, editor: shown } = buffer
            const operations = edits.map((edit) => ({ range: edit.range, text: edit.text }))
            const edit = () => {
                model.pushStackElement()
                model.pushEditOperations(shown ? shown.getSelections() : [], operations, () => null)
                model.pushStackElement()
            }
            if (shown) {
                edit()
                return true
            }
            runSilently(edit)
            updateTabContent(tabId, model.getValue())
            return true
        },
        [updateTabContent, editableBuffer, runSilently]
    )

    const revealInEditor = useCallback(
        (path: string, line: number, column: number, length?: number) => focusedPanel()?.reveal(path, line, column, length),
        [focusedPanel]
    )
    const getEditorSelectedText = useCallback(() => focusedPanel()?.selectedText() ?? null, [focusedPanel])

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { replaceEditorText, applyTabEdits, hasTabBuffer, revealInEditor, getEditorSelectedText })
    }, [coordinator, replaceEditorText, applyTabEdits, hasTabBuffer, revealInEditor, getEditorSelectedText])

    // Free the buffers of tabs that are no longer open, unless an editor still shows one (it is about to move on).
    useEffect(() => {
        const monaco = monacoRef.current
        if (!monaco) return
        const liveKeys = new Set(modelKeys.keys.values())
        const attached = new Set(panelsRef.current.map((p) => p.editor()?.getModel()).filter(Boolean))
        for (const model of monaco.editor.getModels()) {
            const uri = model.uri.toString()
            if (!attached.has(model) && isModelKey(uri) && !liveKeys.has(uri)) model.dispose()
        }
    }, [modelKeys])

    // Every tab's buffer goes with the editor area (a folder closed, the window going).
    const disposeAll = useCallback(() => {
        const monaco = monacoRef.current
        if (!monaco) return
        for (const model of monaco.editor.getModels()) {
            if (isModelKey(model.uri.toString())) model.dispose()
        }
    }, [])
    useEffect(() => disposeAll, [disposeAll])

    const getMonaco = useCallback(() => monacoRef.current, [])
    const setMonaco = useCallback((monaco: Monaco) => {
        monacoRef.current = monaco
    }, [])

    const value = useMemo<EditorModels>(
        () => ({ keys: modelKeys, getMonaco, setMonaco, isSilent, editorChanged, syncModel, latestContent, registerPanel }),
        [modelKeys, getMonaco, setMonaco, isSilent, editorChanged, syncModel, latestContent, registerPanel]
    )

    return <EditorModelsContext.Provider value={value}>{children}</EditorModelsContext.Provider>
}

export function useEditorModels(): EditorModels {
    const ctx = useContext(EditorModelsContext)
    if (!ctx) throw new Error('useEditorModels must be used within EditorModelsProvider')
    return ctx
}
