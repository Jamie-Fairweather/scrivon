'use client'

import { useAppSettings } from '@/components/studio/settings/settings-provider'

export function useEditorPanelLayout() {
    const { settings, setEditorWidth, resetEditorWidth } = useAppSettings()
    const hydrated = typeof window !== 'undefined'

    return {
        width: settings.layout.editorWidth,
        hydrated,
        onWidthChange: setEditorWidth,
        resetEditorWidth,
    }
}
