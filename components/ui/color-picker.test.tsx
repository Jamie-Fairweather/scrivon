import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    ColorPicker,
    ColorPickerAlpha,
    ColorPickerEyeDropper,
    ColorPickerHue,
    ColorPickerSelection,
    hexToHsl,
    hslToHex,
    useColorPicker,
} from '@/components/ui/color-picker'

function Readout() {
    const { hue, saturation, lightness, alpha, setSaturation } = useColorPicker()
    return (
        <>
            <span data-testid="hsl">{`${hue},${saturation},${lightness},${alpha}`}</span>
            <button type="button" onClick={() => setSaturation(200)}>
                Oversaturate
            </button>
        </>
    )
}

function dot(container: HTMLElement): HTMLElement {
    const node = container.querySelector('.pointer-events-none')
    if (!(node instanceof HTMLElement)) throw new Error('missing selection dot')
    return node
}

describe('ColorPicker', () => {
    afterEach(() => {
        delete (window as { EyeDropper?: unknown }).EyeDropper
    })

    it('throws when a part is rendered outside the provider', () => {
        expect(() => render(<ColorPickerHue />)).toThrow('useColorPicker must be used within a ColorPicker')
    })

    it('tracks pointer drags, external values, and an out-of-range saturation', () => {
        const onChange = vi.fn()
        const { container, rerender } = render(
            <ColorPicker className="picker" defaultValue="#000000">
                <ColorPickerSelection />
                <ColorPickerHue />
                <ColorPickerAlpha />
                <Readout />
            </ColorPicker>
        )
        expect(container.querySelector('.picker')).toBeTruthy()
        expect(screen.getByTestId('hsl')).toHaveTextContent('0,0,0,100')
        expect(dot(container)).toHaveStyle({ left: '0%', top: '100%' })

        const field = container.querySelector('.cursor-crosshair')
        if (!(field instanceof HTMLElement)) throw new Error('missing selection field')
        field.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
        fireEvent.pointerDown(field, { clientX: 40, clientY: 25 })
        fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
        fireEvent.pointerUp(window)
        expect(onChange).not.toHaveBeenCalled()

        rerender(
            <ColorPicker value="#ff0000" onChange={onChange}>
                <ColorPickerSelection />
                <ColorPickerHue />
                <ColorPickerAlpha />
                <Readout />
            </ColorPicker>
        )
        expect(screen.getByTestId('hsl').textContent?.startsWith('0,100,50,100')).toBe(true)
        expect(dot(container)).toHaveStyle({ left: '100%' })

        fireEvent.click(screen.getByRole('button', { name: 'Oversaturate' }))
        expect(dot(container)).toHaveStyle({ top: '0%' })

        rerender(
            <ColorPicker value="nope" onChange={onChange}>
                <Readout />
            </ColorPicker>
        )
        expect(screen.getByTestId('hsl')).toBeInTheDocument()

        rerender(
            <ColorPicker onChange={onChange}>
                <Readout />
            </ColorPicker>
        )
        expect(screen.getByTestId('hsl')).toBeInTheDocument()
    })

    it('emits hue and alpha changes from the sliders', () => {
        const onChange = vi.fn()
        render(
            <ColorPicker value="#ff0000" onChange={onChange}>
                <ColorPickerHue />
                <ColorPickerAlpha />
            </ColorPicker>
        )
        const hue = screen.getByRole('group', { name: 'Hue' }).querySelector('input')
        const alpha = screen.getByRole('group', { name: 'Alpha' }).querySelector('input')
        if (!hue || !alpha) throw new Error('missing slider input')
        fireEvent.keyDown(hue, { key: 'ArrowRight' })
        fireEvent.keyDown(alpha, { key: 'ArrowLeft' })
        expect(onChange).toHaveBeenCalled()
    })

    it('hides the eyedropper when the API is missing and keeps alpha when a colour is picked', async () => {
        const hidden = render(
            <ColorPicker value="#ff000080">
                <ColorPickerEyeDropper />
            </ColorPicker>
        )
        expect(screen.queryByRole('button', { name: 'Pick a colour from the screen' })).toBeNull()
        hidden.unmount()

        class EyeDropper {
            open(): Promise<{ sRGBHex: string }> {
                return Promise.resolve({ sRGBHex: '#336699' })
            }
        }
        Object.assign(window, { EyeDropper })
        const onChange = vi.fn()
        render(
            <ColorPicker value="#ff000080" onChange={onChange}>
                <ColorPickerEyeDropper className="dropper" />
            </ColorPicker>
        )
        const button = screen.getByRole('button', { name: 'Pick a colour from the screen' })
        expect(button.className).toContain('dropper')
        await act(async () => {
            fireEvent.click(button)
        })
        const picked = hexToHsl('#336699')
        expect(onChange).toHaveBeenCalledWith(hslToHex(picked.hue, picked.saturation, picked.lightness, 50))
    })

    it('ignores a cancelled eyedropper', async () => {
        class EyeDropper {
            open(): Promise<{ sRGBHex: string }> {
                return Promise.reject(new Error('cancel'))
            }
        }
        Object.assign(window, { EyeDropper })
        const onChange = vi.fn()
        render(
            <ColorPicker value="#ff0000" onChange={onChange}>
                <ColorPickerEyeDropper />
            </ColorPicker>
        )
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Pick a colour from the screen' }))
        })
        expect(onChange).not.toHaveBeenCalled()
    })
})
