'use client'

import { Lock } from 'lucide-react'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { readOnlyReason } from '@/components/studio/workspace/document-tabs-context'
import { useDocumentTabActions, useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'

/**
 * A slim bar above the editor saying why the open file is read-only (not UTF-8, unreadable bytes, or very
 * large) with the way to edit it anyway, so neither is lost once the notice that said so is closed.
 */
export function ReadOnlyReasonBar() {
    const { activeTab } = useDocumentTabs()
    const { makeTabEditable } = useDocumentTabActions()
    const reason = activeTab?.readOnly ? readOnlyReason(activeTab) : null
    if (!activeTab || !reason) return null

    return (
        <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning-foreground"
        >
            <Lock className="size-3.5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
                <span className="font-medium">Read-only.</span> {reason.text}
            </p>
            {reason.editLabel ? (
                <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => {
                        makeTabEditable(activeTab.id)
                        // The bar (and this button) goes away once the tab can be edited, so the keyboard
                        // moves to the editor instead of falling to the page.
                        focusEditorFor(activeTab.path)
                    }}
                >
                    {reason.editLabel}
                </Button>
            ) : null}
        </div>
    )
}
