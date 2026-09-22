'use client'

import type { ReactNode } from 'react'
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
    onChange: (value: number) => void
}

/** Labelled stepper for a bounded numeric setting. Ignores cleared input; the previous value stays. */
export function NumberSetting({ id, label, description, value, min, max, step, onChange }: NumberSettingProps) {
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
            <NumberField
                id={id}
                value={value}
                min={min}
                max={max}
                step={step}
                onValueChange={(next) => {
                    if (next != null) onChange(next)
                }}
            >
                <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput />
                    <NumberFieldIncrement />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    )
}
