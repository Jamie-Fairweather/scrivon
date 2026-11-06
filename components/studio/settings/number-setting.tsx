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

/** Decimal places in a step: 1 → 0, 0.5 → 1, 0.25 → 2. */
function decimalsOf(step: number): number {
    return (String(step).split('.')[1] ?? '').length
}

/** Commit what was typed: blurring runs the field's own parsing, then focus comes straight back. */
function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const input = event.currentTarget
    input.blur()
    input.focus()
}

/**
 * Labelled stepper for a bounded numeric setting. Steps (arrow keys, the +/- buttons) apply at
 * once; typed text applies when you leave the field or press Enter, so a half-typed number never
 * does. Values are kept within min and max and rounded to the step's decimal places. Cleared
 * input is ignored and the previous value stays.
 */
export function NumberSetting({ id, label, description, value, min, max, step, disabled, onChange, className }: NumberSettingProps) {
    const decimals = decimalsOf(step)

    const apply = (next: number | null) => {
        if (next == null || !Number.isFinite(next)) return
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
                format={{ maximumFractionDigits: decimals }}
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
                    <NumberFieldInput onKeyDown={commitOnEnter} />
                    <NumberFieldIncrement />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    )
}
