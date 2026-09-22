'use client'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { OptionSelect, type SelectOption } from '@/components/ui/option-select'
import { Button } from '@/components/ui/button'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
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
                    value={settings.editor.wordWrap}
                    options={WORD_WRAP_OPTIONS}
                    onChange={(wordWrap) => setEditor({ wordWrap })}
                />
            </Field>

            <Field>
                <FieldLabel htmlFor="editor-line-numbers">Line numbers</FieldLabel>
                <OptionSelect
                    id="editor-line-numbers"
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

            <Field>
                <FieldLabel>Editor pane width</FieldLabel>
                <FieldDescription>Reset the editor panel to the default width ({settings.layout.editorWidth}px currently).</FieldDescription>
                <Button type="button" variant="outline" size="sm" onClick={resetEditorWidth}>
                    Reset pane width
                </Button>
            </Field>
        </div>
    )
}
