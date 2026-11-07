import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'

afterEach(cleanup)

function slot(name: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-slot="${name}"]`)
    if (!element) throw new Error(`missing ${name}`)
    return element
}

function Stepper({ value, disabled }: { value: number; disabled?: boolean }) {
    return (
        <Field disabled={disabled}>
            <FieldLabel htmlFor="delay">Delay</FieldLabel>
            <FieldDescription>How long to wait.</FieldDescription>
            <NumberField id="delay" value={value} min={0} max={10}>
                <NumberFieldGroup>
                    <NumberFieldDecrement />
                    <NumberFieldInput />
                    <NumberFieldIncrement />
                </NumberFieldGroup>
            </NumberField>
        </Field>
    )
}

describe('NumberField disabled states', () => {
    it('marks only the + button disabled at the maximum, so it stops looking clickable', () => {
        render(<Stepper value={10} />)

        expect(slot('number-field-increment').hasAttribute('data-disabled')).toBe(true)
        expect(slot('number-field-increment').className).toContain('data-disabled:opacity-64')
        expect(slot('number-field-increment').className).toContain('not-data-disabled:hover:bg-accent')
        expect(slot('number-field-decrement').hasAttribute('data-disabled')).toBe(false)
    })

    it('dims the label and help text along with the control when the whole field is disabled', () => {
        render(<Stepper value={5} disabled />)

        expect(slot('field-label').hasAttribute('data-disabled')).toBe(true)
        expect(slot('field-description').hasAttribute('data-disabled')).toBe(true)
        expect(slot('field-description').className).toContain('data-disabled:opacity-64')
        expect(slot('number-field-group').hasAttribute('data-disabled')).toBe(true)
        expect(slot('number-field-input')).toHaveProperty('disabled', true)
    })
})
