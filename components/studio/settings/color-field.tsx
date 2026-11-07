'use client'

import { useId, useState } from 'react'
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
 * While the popover is open, the picker and the hex text follow a drag or typing. The colour is
 * saved when a drag or key step ends, when the text is left or Enter is pressed, and when the
 * popover closes, so a drag saves once rather than on every pointer move.
 */
export function ColorField({ id, value, placeholder = '#000000', allowEmpty = false, onChange }: ColorFieldProps) {
    const [draft, setDraft] = useState(value)
    const valueId = useId()
    const normalized = normalizeColorHex(value)
    const swatch = normalized ?? (allowEmpty && !value.trim() ? null : FALLBACK_HEX)

    /** Saves a colour (or `''`) unless it is the one already saved. */
    const save = (next: string) => {
        if (next === value || (next !== '' && next === normalized)) return
        onChange(next)
    }

    /** Saves the hex text if it is a colour (or empty, when allowed); otherwise puts the saved value back. */
    const commitDraft = () => {
        if (allowEmpty && draft.trim() === '') {
            save('')
            setDraft('')
            return
        }
        const parsed = normalizeColorHex(draft)
        if (parsed) {
            save(parsed)
            setDraft(parsed)
        } else {
            setDraft(value)
        }
    }

    return (
        <Popover
            onOpenChange={(open) => {
                if (open) setDraft(value || '')
                else commitDraft()
            }}
        >
            <PopoverTrigger
                id={id}
                // With an `id` a <label> names the button, which hides its text; keep the value read out as its description.
                aria-describedby={id ? valueId : undefined}
                className={cn(
                    `inline-flex h-8.5 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-[calc(--spacing(3)-1px)]
                    text-left text-sm text-foreground shadow-xs/5 transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px]
                    focus-visible:ring-ring/24 disabled:pointer-events-none disabled:opacity-64 sm:h-7.5 dark:bg-input/32`
                )}
            >
                <span className="size-4 shrink-0 rounded-sm border border-border" style={swatchStyle(swatch)} />
                <span id={valueId} className={cn('truncate', !value.trim() && 'text-muted-foreground')}>
                    {value.trim() || placeholder}
                </span>
            </PopoverTrigger>
            <PopoverPopup className="w-72 p-3" align="start">
                <ColorPicker
                    // Follows the hex text while it is a colour; while it isn't, the picker stays where it was.
                    value={normalizeColorHex(draft) ?? undefined}
                    defaultValue={normalized ?? FALLBACK_HEX}
                    onChange={setDraft}
                    onChangeEnd={save}
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
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={commitDraft}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') commitDraft()
                            }}
                        />
                    </div>
                </ColorPicker>
            </PopoverPopup>
        </Popover>
    )
}
