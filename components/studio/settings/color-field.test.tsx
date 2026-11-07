import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColorField } from '@/components/studio/settings/color-field'

function renderField({ initial = '#ff0000', allowEmpty = false }: { initial?: string; allowEmpty?: boolean } = {}) {
    const onChange = vi.fn()
    function Harness() {
        const [value, setValue] = useState(initial)
        return (
            <ColorField
                id="colour"
                value={value}
                allowEmpty={allowEmpty}
                onChange={(next) => {
                    onChange(next)
                    setValue(next)
                }}
            />
        )
    }
    render(<Harness />)
    return { onChange, trigger: screen.getByRole('button') }
}

function open(trigger: HTMLElement) {
    fireEvent.click(trigger)
    return screen.getByRole('textbox') as HTMLInputElement
}

function square(): HTMLElement {
    const node = screen.getByRole('slider', { name: 'Saturation and brightness' })
    node.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
    return node
}

/** The range input inside a Base UI slider thumb, which takes its key presses. */
function sliderInput(name: string): HTMLInputElement {
    const input = screen.getByRole('group', { name }).querySelector('input')
    if (!input) throw new Error(`missing ${name} slider input`)
    return input
}

describe('ColorField', () => {
    afterEach(() => {
        delete (window as { EyeDropper?: unknown }).EyeDropper
    })

    it('saves a drag across the colour square once, with the colour it ended on', () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        fireEvent.pointerDown(square(), { clientX: 100, clientY: 0 })
        fireEvent.pointerMove(window, { clientX: 80, clientY: 20 })
        fireEvent.pointerMove(window, { clientX: 60, clientY: 40 })
        fireEvent.pointerMove(window, { clientX: 50, clientY: 50 })
        // The hex text follows the drag, but nothing is saved yet.
        const shown = input.value
        expect(shown).not.toBe('#ff0000')
        expect(onChange).not.toHaveBeenCalled()

        fireEvent.pointerUp(window)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith(shown)
        expect(trigger).toHaveAccessibleDescription(shown)
    })

    it('saves a key step on the square and the hue slider when the key is released', () => {
        const { onChange, trigger } = renderField()
        open(trigger)

        fireEvent.keyDown(square(), { key: 'ArrowLeft' })
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.keyUp(square(), { key: 'ArrowLeft' })
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith('#ff0303')

        const hue = sliderInput('Hue')
        fireEvent.keyDown(hue, { key: 'ArrowRight' })
        expect(onChange).toHaveBeenCalledTimes(1)
        fireEvent.keyUp(hue, { key: 'ArrowRight' })
        expect(onChange).toHaveBeenCalledTimes(2)
        expect(onChange.mock.lastCall?.[0]).not.toBe('#ff0303')
    })

    it('saves once when an arrow key is held down on the square or a slider', () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        fireEvent.keyDown(square(), { key: 'ArrowDown' })
        for (let i = 0; i < 5; i++) fireEvent.keyDown(square(), { key: 'ArrowDown', repeat: true })
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.keyUp(square(), { key: 'ArrowDown' })
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith(input.value)

        const hue = sliderInput('Hue')
        fireEvent.keyDown(hue, { key: 'ArrowRight' })
        for (let i = 0; i < 5; i++) fireEvent.keyDown(hue, { key: 'ArrowRight', repeat: true })
        expect(onChange).toHaveBeenCalledTimes(1)
        fireEvent.keyUp(hue, { key: 'ArrowRight' })
        expect(onChange).toHaveBeenCalledTimes(2)
        expect(onChange).toHaveBeenLastCalledWith(input.value)
        expect(hue).toHaveAttribute('aria-valuenow', '6')
    })

    it('saves a held key change when focus leaves before the key is released', () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        const hue = sliderInput('Hue')
        fireEvent.keyDown(hue, { key: 'ArrowRight' })
        fireEvent.keyDown(hue, { key: 'ArrowRight', repeat: true })
        fireEvent.blur(hue)

        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith(input.value)
    })

    it('saves nothing when a key or press does not change the colour', () => {
        const { onChange, trigger } = renderField({ initial: '#2563eb' })
        const input = open(trigger)

        // The picker holds this colour as HSL, which turns back into #2564eb, so a press that
        // changes nothing must not report a change.
        const alpha = sliderInput('Alpha')
        fireEvent.keyDown(alpha, { key: 'End' })
        fireEvent.keyUp(alpha, { key: 'End' })
        fireEvent.blur(alpha)

        expect(onChange).not.toHaveBeenCalled()
        expect(input.value).toBe('#2563eb')
    })

    it('leaves an empty optional colour empty when a key changes nothing', async () => {
        const { onChange, trigger } = renderField({ initial: '', allowEmpty: true })
        open(trigger)

        const alpha = sliderInput('Alpha')
        fireEvent.keyDown(alpha, { key: 'End' })
        fireEvent.keyUp(alpha, { key: 'End' })
        expect(onChange).not.toHaveBeenCalled()

        fireEvent.keyDown(alpha, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(onChange).not.toHaveBeenCalled()
    })

    it('saves typed hex text on Enter or when it is left, not on every keystroke', () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        fireEvent.change(input, { target: { value: '#336' } })
        fireEvent.change(input, { target: { value: '#3366' } })
        fireEvent.change(input, { target: { value: '#336699' } })
        expect(onChange).not.toHaveBeenCalled()

        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('#336699')

        fireEvent.change(input, { target: { value: '#ABC' } })
        fireEvent.blur(input)
        expect(onChange).toHaveBeenLastCalledWith('#aabbcc')
        expect(input.value).toBe('#aabbcc')
    })

    it('puts the saved colour back when the text is not a colour', () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        fireEvent.change(input, { target: { value: '#12' } })
        fireEvent.blur(input)

        expect(onChange).not.toHaveBeenCalled()
        expect(input.value).toBe('#ff0000')
    })

    it('does not save the colour it already has', () => {
        const { onChange, trigger } = renderField({ initial: '#FFF' })
        const input = open(trigger)

        fireEvent.change(input, { target: { value: '#ffffff' } })
        fireEvent.blur(input)

        expect(onChange).not.toHaveBeenCalled()
    })

    it('saves typed text that was not committed when the popover closes', async () => {
        const { onChange, trigger } = renderField()
        const input = open(trigger)

        fireEvent.change(input, { target: { value: '#00ff00' } })
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.keyDown(input, { key: 'Escape' })

        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
        expect(onChange).toHaveBeenLastCalledWith('#00ff00')
        expect(trigger).toHaveAccessibleDescription('#00ff00')
    })

    it('saves an empty value when clearing is allowed', () => {
        const { onChange, trigger } = renderField({ initial: '#ff0000', allowEmpty: true })
        const input = open(trigger)

        fireEvent.change(input, { target: { value: '  ' } })
        expect(onChange).not.toHaveBeenCalled()
        fireEvent.blur(input)

        expect(onChange).toHaveBeenCalledWith('')
        expect(input.value).toBe('')
    })

    it('saves a colour picked with the eyedropper', async () => {
        class EyeDropper {
            open(): Promise<{ sRGBHex: string }> {
                return Promise.resolve({ sRGBHex: '#336699' })
            }
        }
        Object.assign(window, { EyeDropper })
        const { onChange, trigger } = renderField()
        open(trigger)

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pick a colour from the screen' }))
        })

        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('#336699')
    })
})
