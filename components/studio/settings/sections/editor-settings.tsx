'use client'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { OptionSelect, type SelectOption } from '@/components/ui/option-select'
import { Button } from '@/components/ui/button'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SpellingSettings } from '@/components/studio/settings/sections/spelling-settings'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import { tabFocusToggleKeyLabel } from '@/lib/monaco/editor-aria'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import type { AppSettings, EditorLineNumbers, EditorWordWrap } from '@/lib/settings/types'

const WORD_WRAP_OPTIONS: SelectOption<EditorWordWrap>[] = [
    { label: 'On', value: 'on' },
    { label: 'Off', value: 'off' },
    { label: 'At column', value: 'wordWrapColumn' },
]
const LINE_NUMBER_OPTIONS: SelectOption<EditorLineNumbers>[] = [
    { label: 'On', value: 'on' },
    { label: 'Off', value: 'off' },
    { label: 'Relative', value: 'relative' },
]

export function EditorSettings() {
    const { settings, updateSettings, resetEditorWidth } = useAppSettings()
    const setEditor = (changes: Partial<AppSettings['editor']>) =>
        updateSettings((current) => ({ ...current, editor: { ...current.editor, ...changes } }))

    return (
        <div className="space-y-6">
            <NumberSetting
                id="editor-font-size"
                label="Font size"
                value={settings.editor.fontSize}
                min={8}
                max={32}
                step={1}
                onChange={(fontSize) => setEditor({ fontSize })}
            />
            <NumberSetting
                id="editor-tab-size"
                label="Tab size"
                value={settings.editor.tabSize}
                min={1}
                max={8}
                step={1}
                onChange={(tabSize) => setEditor({ tabSize })}
            />

            <Field>
                <FieldLabel htmlFor="editor-word-wrap">Word wrap</FieldLabel>
                <OptionSelect
                    id="editor-word-wrap"
                    className="w-40"
                    value={settings.editor.wordWrap}
                    options={WORD_WRAP_OPTIONS}
                    onChange={(wordWrap) => setEditor({ wordWrap })}
                />
            </Field>

            {settings.editor.wordWrap === 'wordWrapColumn' ? (
                <NumberSetting
                    id="editor-wrap-column"
                    label="Wrap column"
                    description="Lines wrap after this many characters, even when the pane is narrower."
                    value={settings.editor.wordWrapColumn}
                    min={20}
                    max={200}
                    step={1}
                    onChange={(wordWrapColumn) => setEditor({ wordWrapColumn })}
                />
            ) : null}

            <Field>
                <FieldLabel htmlFor="editor-line-numbers">Line numbers</FieldLabel>
                <OptionSelect
                    id="editor-line-numbers"
                    className="w-40"
                    value={settings.editor.lineNumbers}
                    options={LINE_NUMBER_OPTIONS}
                    onChange={(lineNumbers) => setEditor({ lineNumbers })}
                />
            </Field>

            <SwitchSetting
                label="Minimap"
                description="Show a code minimap in the editor gutter."
                checked={settings.editor.minimap}
                onChange={(minimap) => setEditor({ minimap })}
            />

            <SwitchSetting
                label="Tab key moves focus"
                description={`Tab and Shift+Tab move to the next part of the window instead of indenting. ${tabFocusToggleKeyLabel(isMacPlatform())} switches this while you type.`}
                checked={settings.editor.tabMovesFocus}
                onChange={(tabMovesFocus) => setEditor({ tabMovesFocus })}
            />

            <SwitchSetting
                label="Status bar"
                description="Show the line and column, word count and save state at the bottom of the window."
                checked={settings.statusBar.visible}
                onChange={(visible) => updateSettings((current) => ({ ...current, statusBar: { ...current.statusBar, visible } }))}
            />

            <SwitchSetting
                label="Scroll with the preview"
                description="The editor and the Markdown preview scroll together."
                checked={settings.editor.scrollSync}
                onChange={(scrollSync) => setEditor({ scrollSync })}
            />

            <SwitchSetting
                label="Double-click the preview to jump to the editor"
                description="Double-clicking the Markdown preview puts the editor's cursor on that line. Turn off to select words in the preview by double-clicking."
                checked={settings.editor.jumpFromPreview}
                onChange={(jumpFromPreview) => setEditor({ jumpFromPreview })}
            />

            <Field>
                <FieldLabel>Editor pane width</FieldLabel>
                <FieldDescription>Reset the editor panel to the default width ({settings.layout.editorWidth}px currently).</FieldDescription>
                <Button type="button" variant="outline" size="sm" onClick={resetEditorWidth}>
                    Reset pane width
                </Button>
            </Field>

            <SpellingSettings />
        </div>
    )
}
