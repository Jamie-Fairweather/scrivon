'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
    ColorPicker,
    ColorPickerAlpha,
    ColorPickerEyeDropper,
    ColorPickerFormat,
    ColorPickerHue,
    ColorPickerOutput,
    ColorPickerSelection,
    normalizeColorHex,
} from '@/components/ui/color-picker'
import { Input } from '@/components/ui/input'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'

type ColorFieldProps = {
    id?: string
    value: string
    placeholder?: string
    allowEmpty?: boolean
    onChange: (value: string) => void
}

export function ColorField({ id, value, placeholder = '#000000', allowEmpty = false, onChange }: ColorFieldProps) {
    const [draft, setDraft] = useState(value)
    const swatch = normalizeColorHex(value) ?? (allowEmpty && !value.trim() ? 'transparent' : '#262626')
    const pickerValue = normalizeColorHex(value) ?? '#262626'

    return (
        <Popover
            onOpenChange={(open) => {
                if (open) setDraft(value || '')
            }}
        >
            <PopoverTrigger
                id={id}
                className={cn(
                    `inline-flex h-8.5 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-[calc(--spacing(3)-1px)]
                    text-left text-sm text-foreground shadow-xs/5 transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px]
                    focus-visible:ring-ring/24 sm:h-7.5 dark:bg-input/32`
                )}
            >
                <span
                    className="size-4 shrink-0 rounded-sm border border-border"
                    style={
                        swatch === 'transparent'
                            ? {
                                  backgroundImage:
                                      'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                                  backgroundSize: '8px 8px',
                                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                              }
                            : { backgroundColor: swatch }
                    }
                />
                <span className={cn('truncate', !value.trim() && 'text-muted-foreground')}>{value.trim() || placeholder}</span>
            </PopoverTrigger>
            <PopoverPopup className="w-72 p-3" align="start">
                <ColorPicker
                    value={pickerValue}
                    onChange={(hex) => {
                        setDraft(hex)
                        onChange(hex)
                    }}
                >
                    <ColorPickerSelection className="h-40" />
                    <ColorPickerHue />
                    <ColorPickerAlpha />
                    <div className="flex items-center gap-2">
                        <ColorPickerEyeDropper />
                        <ColorPickerOutput />
                        <ColorPickerFormat />
                    </div>
                    <Input
                        value={draft}
                        placeholder={placeholder}
                        spellCheck={false}
                        onChange={(event) => {
                            const next = event.target.value
                            setDraft(next)
                            if (allowEmpty && next.trim() === '') {
                                onChange('')
                                return
                            }
                            const normalized = normalizeColorHex(next)
                            if (normalized) onChange(normalized)
                        }}
                        onBlur={() => {
                            if (allowEmpty && draft.trim() === '') {
                                onChange('')
                                setDraft('')
                                return
                            }
                            const normalized = normalizeColorHex(draft)
                            if (normalized) {
                                onChange(normalized)
                                setDraft(normalized)
                            } else {
                                setDraft(value)
                            }
                        }}
                    />
                </ColorPicker>
            </PopoverPopup>
        </Popover>
    )
}
