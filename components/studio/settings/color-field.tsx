'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
    COLOR_CHECKERBOARD,
    COLOR_CHECKERBOARD_POSITION,
    COLOR_CHECKERBOARD_SIZE,
    ColorPicker,
    ColorPickerAlpha,
    ColorPickerEyeDropper,
    ColorPickerHue,
    ColorPickerSelection,
    normalizeColorHex,
} from '@/components/ui/color-picker'
import { Input } from '@/components/ui/input'
import { Popover, PopoverPopup, PopoverTrigger } from '@/components/ui/popover'

const FALLBACK_HEX = '#262626'

type ColorFieldProps = {
    id?: string
    value: string
    placeholder?: string
    allowEmpty?: boolean
    onChange: (value: string) => void
}

/** Swatch style: the colour (which may be translucent) painted over a checkerboard; checkerboard alone when empty. */
function swatchStyle(hex: string | null) {
    return {
        backgroundImage: hex ? `linear-gradient(${hex}, ${hex}), ${COLOR_CHECKERBOARD}` : COLOR_CHECKERBOARD,
        backgroundSize: hex ? `100% 100%, ${COLOR_CHECKERBOARD_SIZE}` : COLOR_CHECKERBOARD_SIZE,
        backgroundPosition: hex ? `0 0, ${COLOR_CHECKERBOARD_POSITION}` : COLOR_CHECKERBOARD_POSITION,
    }
}

/**
 * Hex colour input with a popover picker. Stores `#rrggbb`, or `#rrggbbaa` when
 * translucent. With `allowEmpty`, a cleared field stores `''` (the caller's default).
 */
export function ColorField({ id, value, placeholder = '#000000', allowEmpty = false, onChange }: ColorFieldProps) {
    const [draft, setDraft] = useState(value)
    const normalized = normalizeColorHex(value)
    const swatch = normalized ?? (allowEmpty && !value.trim() ? null : FALLBACK_HEX)

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
                <span className="size-4 shrink-0 rounded-sm border border-border" style={swatchStyle(swatch)} />
                <span className={cn('truncate', !value.trim() && 'text-muted-foreground')}>{value.trim() || placeholder}</span>
            </PopoverTrigger>
            <PopoverPopup className="w-72 p-3" align="start">
                <ColorPicker
                    value={normalized ?? FALLBACK_HEX}
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
                        <Input
                            className="min-w-0 flex-1"
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
                                const parsed = normalizeColorHex(next)
                                if (parsed) onChange(parsed)
                            }}
                            onBlur={() => {
                                if (allowEmpty && draft.trim() === '') {
                                    onChange('')
                                    setDraft('')
                                    return
                                }
                                const parsed = normalizeColorHex(draft)
                                if (parsed) {
                                    onChange(parsed)
                                    setDraft(parsed)
                                } else {
                                    setDraft(value)
                                }
                            }}
                        />
                    </div>
                </ColorPicker>
            </PopoverPopup>
        </Popover>
    )
}
