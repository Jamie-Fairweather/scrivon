'use client'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Select, SelectButton, SelectItem, SelectPopup, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { EditorLineNumbers, EditorWordWrap } from '@/lib/settings/types'

export function EditorSettings() {
    const { settings, updateSettings, resetEditorWidth } = useAppSettings()

    return (
        <div className="space-y-6">
            <Field>
                <FieldLabel htmlFor="editor-font-size">Font size</FieldLabel>
                <NumberField
                    id="editor-font-size"
                    value={settings.editor.fontSize}
                    min={8}
                    max={32}
                    step={1}
                    onValueChange={(value) => {
                        if (value != null) {
                            updateSettings((current) => ({
                                ...current,
                                editor: { ...current.editor, fontSize: value },
                            }))
                        }
                    }}
                >
                    <NumberFieldGroup>
                        <NumberFieldDecrement />
                        <NumberFieldInput />
                        <NumberFieldIncrement />
                    </NumberFieldGroup>
                </NumberField>
            </Field>

            <Field>
                <FieldLabel htmlFor="editor-tab-size">Tab size</FieldLabel>
                <NumberField
                    id="editor-tab-size"
                    value={settings.editor.tabSize}
                    min={1}
                    max={8}
                    step={1}
                    onValueChange={(value) => {
                        if (value != null) {
                            updateSettings((current) => ({
                                ...current,
                                editor: { ...current.editor, tabSize: value },
                            }))
                        }
                    }}
                >
                    <NumberFieldGroup>
                        <NumberFieldDecrement />
                        <NumberFieldInput />
                        <NumberFieldIncrement />
                    </NumberFieldGroup>
                </NumberField>
            </Field>

            <Field>
                <FieldLabel htmlFor="editor-word-wrap">Word wrap</FieldLabel>
                <Select
                    value={settings.editor.wordWrap}
                    onValueChange={(value) => {
                        if (value) {
                            updateSettings((current) => ({
                                ...current,
                                editor: { ...current.editor, wordWrap: value as EditorWordWrap },
                            }))
                        }
                    }}
                >
                    <SelectButton id="editor-word-wrap">
                        <SelectValue />
                    </SelectButton>
                    <SelectPopup>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="wordWrapColumn">At column</SelectItem>
                    </SelectPopup>
                </Select>
            </Field>

            <Field>
                <FieldLabel htmlFor="editor-line-numbers">Line numbers</FieldLabel>
                <Select
                    value={settings.editor.lineNumbers}
                    onValueChange={(value) => {
                        if (value) {
                            updateSettings((current) => ({
                                ...current,
                                editor: { ...current.editor, lineNumbers: value as EditorLineNumbers },
                            }))
                        }
                    }}
                >
                    <SelectButton id="editor-line-numbers">
                        <SelectValue />
                    </SelectButton>
                    <SelectPopup>
                        <SelectItem value="on">On</SelectItem>
                        <SelectItem value="off">Off</SelectItem>
                        <SelectItem value="relative">Relative</SelectItem>
                    </SelectPopup>
                </Select>
            </Field>

            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Minimap</FieldLabel>
                        <FieldDescription>Show a code minimap in the editor gutter.</FieldDescription>
                    </div>
                    <Switch
                        checked={settings.editor.minimap}
                        onCheckedChange={(checked) =>
                            updateSettings((current) => ({
                                ...current,
                                editor: { ...current.editor, minimap: checked === true },
                            }))
                        }
                    />
                </div>
            </Field>

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
