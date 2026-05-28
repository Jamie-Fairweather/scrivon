'use client'

import { useCallback } from 'react'
import { useNamePrompt } from '@/components/studio/dialogs/name-prompt-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export function useFileTreeActions(parentPath: string | null) {
    const { promptName } = useNamePrompt()
    const { createFile, createFolder } = useWorkspaceSession()

    const createMermaidFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New diagram name', 'diagram.mmd')
        if (name) await createFile(parentPath, name)
    }, [parentPath, promptName, createFile])

    const createMarkdownFileInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New document name', 'document.md')
        if (name) await createFile(parentPath, name)
    }, [parentPath, promptName, createFile])

    const createFolderInParent = useCallback(async () => {
        if (!parentPath) return
        const name = await promptName('New folder name', 'diagrams')
        if (name) await createFolder(parentPath, name)
    }, [parentPath, promptName, createFolder])

    return { createMermaidFileInParent, createMarkdownFileInParent, createFolderInParent }
}
