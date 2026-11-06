'use client'

import { useCallback } from 'react'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useFileTreeActions(parentPath: string | null) {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder, suggestName } = useWorkspaceSession()

    const createMermaidFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New diagram name', suggestName(parentPath, 'diagram.mmd'))
        if (name) await createFile(parentPath, name)
    }, [parentPath, promptName, createFile, suggestName])

    const createMarkdownFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New document name', suggestName(parentPath, 'document.md'))
        if (name) await createFile(parentPath, name)
    }, [parentPath, promptName, createFile, suggestName])

    const createFolderInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New folder name', suggestName(parentPath, 'diagrams'))
        if (name) await createFolder(parentPath, name)
    }, [parentPath, promptName, createFolder, suggestName])

    return { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent }
}
