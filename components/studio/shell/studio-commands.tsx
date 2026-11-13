'use client'

import { useExitCommand, useSettingsCommand } from '@/components/studio/shell/shell-commands'
import { useThemeCommands } from '@/components/studio/theme/theme-commands'
import { useDocumentCommands } from '@/components/studio/workspace/document-commands'
import { useLayoutCommands } from '@/components/studio/workspace/layout-commands'
import { useWorkspaceCommands } from '@/components/studio/workspace/workspace-commands'

/**
 * Registers the commands of the features that have no component of their own to do it from. Other
 * features (the editor, Help) register theirs where they live, with useRegisterCommands.
 *
 * The order here is the palette's order: the commands people want most come first, the long list of
 * themes near the end, and Exit last, so it never shows among the palette's first suggestions.
 */
export function StudioCommands() {
    useSettingsCommand()
    useWorkspaceCommands()
    useDocumentCommands()
    useLayoutCommands()
    useThemeCommands()
    useExitCommand()
    return null
}
