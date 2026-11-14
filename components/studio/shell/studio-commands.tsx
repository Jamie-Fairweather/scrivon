'use client'

import { usePaletteCommands } from '@/components/studio/command-palette/palette-commands'
import { useExplorerCommands } from '@/components/studio/explorer/explorer-commands'
import { useNewItemCommands } from '@/components/studio/explorer/new-item-commands'
import { useSettingSwitchCommands } from '@/components/studio/settings/setting-switch-commands'
import { usePaneFocusCommands } from '@/components/studio/shell/pane-focus-commands'
import { useExitCommand, useSettingsCommand } from '@/components/studio/shell/shell-commands'
import { useThemeCommands } from '@/components/studio/theme/theme-commands'
import { useDocumentCommands } from '@/components/studio/workspace/document-commands'
import { useLayoutCommands } from '@/components/studio/workspace/layout-commands'
import { useWorkspaceCommands } from '@/components/studio/workspace/workspace-commands'
import { useAppZoomCommands } from '@/components/studio/zoom/app-zoom-commands'

/**
 * Registers the commands of the features that have no component of their own to do it from. Other
 * features (the editor, Help) register theirs where they live, with useRegisterCommands.
 *
 * The order here is the palette's order: the commands people want most come first, then the long list
 * of themes, then Exit, so it never shows among the palette's first suggestions. Commands registered
 * further down the tree follow these: Help's, then the editor's (Undo to Go to Line). Those are
 * found by typing their name, and the Edit menu lists them.
 */
export function StudioCommands() {
    useSettingsCommand()
    useWorkspaceCommands()
    useNewItemCommands()
    useDocumentCommands()
    useLayoutCommands()
    useSettingSwitchCommands()
    usePaletteCommands()
    usePaneFocusCommands()
    useExplorerCommands()
    useAppZoomCommands()
    useThemeCommands()
    useExitCommand()
    return null
}
