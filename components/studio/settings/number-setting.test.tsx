import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NumberSetting } from '@/components/studio/settings/number-setting'

function renderSetting({ initial, min, max, step }: { initial: number; min: number; max: number; step: number }) {
    const onChange = vi.fn()
    function Harness() {
        const [value, setValue] = useState(initial)
        return (
            <NumberSetting
                id="setting"
                label="Setting"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(next) => {
                    onChange(next)
                    setValue(next)
                }}
            />
        )
    }
    render(<Harness />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    return { input, onChange }
}

function type(input: HTMLInputElement, text: string) {
    act(() => input.focus())
    // One change per keystroke, like a person typing.
    for (let length = 1; length <= text.length; length++) {
        fireEvent.change(input, { target: { value: text.slice(0, length) } })
    }
}

describe('NumberSetting', () => {
    it('applies typed text once, when the field is left, not on every keystroke', () => {
        const { input, onChange } = renderSetting({ initial: 13, min: 8, max: 32, step: 1 })

        type(input, '16')
        expect(onChange).not.toHaveBeenCalled()

        fireEvent.blur(input)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith(16)
    })

    it('keeps a typed value within range and shows the value it kept', () => {
        const { input, onChange } = renderSetting({ initial: 13, min: 8, max: 32, step: 1 })

        type(input, '50')
        fireEvent.blur(input)

        expect(onChange).toHaveBeenCalledWith(32)
        expect(input.value).toBe('32')
    })

    it('rounds typed decimals to the step', () => {
        const { input, onChange } = renderSetting({ initial: 4, min: 1, max: 8, step: 1 })

        type(input, '2.4')
        fireEvent.blur(input)

        expect(onChange).toHaveBeenCalledWith(2)
        expect(input.value).toBe('2')
    })

    it('keeps decimals a fractional step allows', () => {
        const { input, onChange } = renderSetting({ initial: 1.6, min: 1, max: 2.5, step: 0.1 })

        fireEvent.keyDown(input, { key: 'ArrowUp' })
        expect(onChange).toHaveBeenLastCalledWith(1.7)

        type(input, '1.25')
        fireEvent.blur(input)
        expect(onChange).toHaveBeenLastCalledWith(1.3)
    })

    it('applies typed text on Enter', () => {
        const { input, onChange } = renderSetting({ initial: 13, min: 8, max: 32, step: 1 })

        type(input, '20')
        fireEvent.keyDown(input, { key: 'Enter' })

        expect(onChange).toHaveBeenCalledWith(20)
        expect(document.activeElement).toBe(input)
    })

    it('applies arrow-key steps at once, with Shift stepping ten steps', () => {
        const { input, onChange } = renderSetting({ initial: 1000, min: 200, max: 5000, step: 100 })

        fireEvent.keyDown(input, { key: 'ArrowUp' })
        expect(onChange).toHaveBeenLastCalledWith(1100)

        fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true })
        expect(onChange).toHaveBeenLastCalledWith(2100)
        expect(onChange).toHaveBeenCalledTimes(2)
    })

    it('keeps the previous value when the field is cleared', () => {
        const { input, onChange } = renderSetting({ initial: 13, min: 8, max: 32, step: 1 })

        act(() => input.focus())
        fireEvent.change(input, { target: { value: '' } })
        fireEvent.blur(input)

        expect(onChange).not.toHaveBeenCalled()
        expect(input.value).toBe('13')
    })
})
