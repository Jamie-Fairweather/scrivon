'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'

type NumberSettingProps = {
    id?: string
    label: ReactNode
    description?: ReactNode
    value: number
    min: number
    max: number
    step: number
    disabled?: boolean
    onChange: (value: number) => void
    /** For the stepper, which is a fixed width so a small number doesn't get a full-width control. */
    className?: string
}

/** Changes that come from typing. They wait until the field is committed (blur or Enter). */
const TYPING_REASONS = new Set(['input-change', 'input-clear', 'input-paste', 'input-blur'])

/** Decimal places in a number: 1 → 0, 0.5 → 1, 0.25 → 2. */
function decimalsOf(step: number): number {
    return (String(step).split('.')[1] ?? '').length
}

/** Enough for any value a person typed; past this it's floating-point noise (1.7000000000000002). */
const MAX_SHOWN_DECIMALS = 6

/**
 * Commit what was typed on Enter, and on Esc before it closes Settings (the field may be gone
 * before it could see a blur). Blurring runs the field's own parsing, then focus comes straight
 * back. The key is left to carry on, so Esc still closes the dialog.
 */
function commitOnKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    const input = event.currentTarget
    input.blur()
    input.focus()
}

/**
 * Labelled stepper for a bounded numeric setting. Steps (arrow keys, the +/- buttons) apply at
 * once; typed text applies when you leave the field or press Enter or Esc, so a half-typed number never
 * does. Values are kept within min and max and rounded to the step's decimal places. Cleared
 * input is ignored and the previous value stays. A saved value with more decimals than the step
 * (a 12.7 mm margin from an older version) is shown as it is and kept until it's changed.
 */
export function NumberSetting({ id, label, description, value, min, max, step, disabled, onChange, className }: NumberSettingProps) {
    const decimals = decimalsOf(step)
    // Showing fewer decimals would round the saved value, and leaving the field would then save that.
    const shownDecimals = Math.max(decimals, Math.min(MAX_SHOWN_DECIMALS, decimalsOf(value)))

    const apply = (next: number | null) => {
        // The saved value typed again is left as it is, even with more decimals than the step.
        if (next == null || !Number.isFinite(next) || next === value) return
        const clean = Math.min(max, Math.max(min, Number(next.toFixed(decimals))))
        if (clean !== value) onChange(clean)
    }

    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <NumberField
                id={id}
                className={cn('w-40', className)}
                value={value}
                min={min}
                max={max}
                step={step}
                smallStep={step}
                largeStep={step * 10}
                format={{ maximumFractionDigits: shownDecimals }}
                disabled={disabled}
                onValueChange={(next, details) => {
                    if (!TYPING_REASONS.has(details.reason)) apply(next)
                }}
                onValueCommitted={(next, details) => {
                    if (details.reason === 'input-blur') apply(next)
                }}
            >
                <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput onKeyDown={commitOnKey} />
                    <NumberFieldIncrement />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    )
}
