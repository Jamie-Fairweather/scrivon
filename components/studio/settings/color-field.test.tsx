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

    it('saves each key step on the square and the hue slider', () => {
        const { onChange, trigger } = renderField()
        open(trigger)

        fireEvent.keyDown(square(), { key: 'ArrowLeft' })
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenLastCalledWith('#ff0303')

        const hue = screen.getByRole('group', { name: 'Hue' }).querySelector('input')
        if (!hue) throw new Error('missing hue slider input')
        fireEvent.keyDown(hue, { key: 'ArrowRight' })
        expect(onChange).toHaveBeenCalledTimes(2)
        expect(onChange.mock.lastCall?.[0]).not.toBe('#ff0303')
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
