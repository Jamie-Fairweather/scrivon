'use client'

import { CircleAlert, Loader2, Lock } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useEditorCursor } from '@/components/studio/editor/editor-cursor'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentSave, useDocumentTabs, useStudioLayout } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { LARGE_FILE_BYTES } from '@/lib/workspace/document-tab'
import { countCharacters, countWords, lineEndingsOf, type LineEndings } from '@/lib/workspace/text-stats'
import { DEFAULT_TEXT_FORMAT } from '@/lib/workspace/text-encoding'
import type { DocumentTab } from '@/lib/workspace/types'

function plural(count: number, word: string): string {
    return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

/** "12 words", or "3 of 12 words" while some of the text is selected. */
function countLabel(total: number, selected: number | null, word: string): string {
    return selected === null ? plural(total, word) : `${selected.toLocaleString()} of ${plural(total, word)}`
}

const LINE_ENDINGS: Record<LineEndings, { label: string; title: string }> = {
    CRLF: { label: 'CRLF', title: 'Windows line endings (CRLF)' },
    LF: { label: 'LF', title: 'Unix line endings (LF)' },
    mixed: { label: 'Mixed line endings', title: 'This file uses more than one kind of line ending' },
}

/** How the file's text is stored on disk, or null when there is no file or it isn't text Scrivon can read. */
function encodingLabel(tab: DocumentTab): string | null {
    if (isExampleTabId(tab.id) || tab.encodingIssue === 'binary') return null
    if (tab.encodingIssue === 'legacy-encoding') return 'Windows-1252'
    const format = tab.format ?? DEFAULT_TEXT_FORMAT
    if (format.encoding === 'utf-16le') return 'UTF-16 LE'
    if (format.encoding === 'utf-16be') return 'UTF-16 BE'
    return format.bom ? 'UTF-8 with BOM' : 'UTF-8'
}

/** A failed save, as a button that shows why and lets the user try again. */
function SaveFailed({ tab, error }: { tab: DocumentTab; error: string }) {
    const { retrySave } = useDocumentSave()
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                title={error}
                render={
                    <Button
                        variant="ghost"
                        size="xs"
                        className="-ms-2 h-5 font-medium text-destructive-foreground hover:bg-destructive/10 hover:text-destructive-foreground sm:h-5"
                    />
                }
            >
                <CircleAlert aria-hidden />
                Save failed
            </PopoverTrigger>
            <PopoverPopup side="top" align="start" className="w-80">
                <div className="space-y-2">
                    <PopoverTitle className="text-sm">Couldn&apos;t save {tab.name}</PopoverTitle>
                    <PopoverDescription className="break-words">{error}</PopoverDescription>
                    <div className="flex justify-end pt-1">
                        <Button
                            size="sm"
                            onClick={() => {
                                setOpen(false)
                                // This button goes as soon as the save starts, so the keyboard goes back to the file.
                                focusEditorFor(tab.path)
                                void retrySave(tab.id)
                            }}
                        >
                            Try Again
                        </Button>
                    </div>
                </div>
            </PopoverPopup>
        </Popover>
    )
}

function SaveState({ tab }: { tab: DocumentTab }) {
    if (tab.readOnly) {
        return (
            <span className="flex items-center gap-1">
                <Lock className="size-3" aria-hidden />
                Read-only
            </span>
        )
    }
    // A save that runs again after a failure is shown as saving until it ends.
    if (tab.isSaving) {
        return (
            <span className="flex items-center gap-1">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Saving…
            </span>
        )
    }
    if (tab.saveError) return <SaveFailed tab={tab} error={tab.saveError} />
    return <span>{tab.isDirty ? 'Unsaved' : 'Saved'}</span>
}

/** A strip along the bottom of the window with facts about the open file, unless Settings hides it. */
export function StudioStatusBar() {
    const { settings } = useAppSettings()
    // Hidden, it doesn't count words, so typing doesn't do that work for nothing.
    return settings.statusBar.visible ? <StatusBarContent /> : null
}

function StatusBarContent() {
    const { activeTab } = useDocumentTabs()
    const { layout } = useStudioLayout()
    const cursor = useEditorCursor()
    const content = useDeferredValue(activeTab?.content ?? '')
    const lineEndings = useMemo(() => {
        const kind = lineEndingsOf(content)
        return kind ? LINE_ENDINGS[kind] : null
    }, [content])
    // Counting takes about 25 ms a megabyte, all in one go after each edit, so very large files go without.
    const counts = useMemo(
        () => (content.length > LARGE_FILE_BYTES ? null : { words: countWords(content), characters: countCharacters(content) }),
        [content]
    )
    // A hidden editor's caret and selection can't be seen, so they aren't shown here either.
    const showCursor = layout.editorOpen && cursor !== null
    const selectedText = useDeferredValue(showCursor && counts ? cursor.selectedText : '')
    const selection = useMemo(
        () => (selectedText ? { words: countWords(selectedText), characters: countCharacters(selectedText) } : null),
        [selectedText]
    )

    const encoding = activeTab ? encodingLabel(activeTab) : null

    return (
        <footer
            aria-label="Status bar"
            className="flex h-6 shrink-0 items-center gap-4 overflow-hidden border-t border-border bg-background px-3 text-xs whitespace-nowrap
                text-muted-foreground"
        >
            {activeTab && (
                <>
                    <SaveState tab={activeTab} />
                    <div className="flex-1" />
                    {showCursor && <span>{`Ln ${cursor.line}, Col ${cursor.column}`}</span>}
                    {counts && (
                        <>
                            <span>{countLabel(counts.words, selection?.words ?? null, 'word')}</span>
                            <span>{countLabel(counts.characters, selection?.characters ?? null, 'character')}</span>
                        </>
                    )}
                    {lineEndings && <span title={lineEndings.title}>{lineEndings.label}</span>}
                    {encoding && <span title="Text encoding">{encoding}</span>}
                </>
            )}
        </footer>
    )
}
