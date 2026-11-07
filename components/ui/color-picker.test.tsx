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

    it('places the thumb on the colour and keeps it under the pointer along the black row', () => {
        const onChange = vi.fn()
        const { container } = render(
            <ColorPicker value="#ff8080" onChange={onChange}>
                <ColorPickerSelection />
            </ColorPicker>
        )
        // #ff8080 is half-saturated (HSV) at full value: the middle of the top edge, not the top-right corner.
        expect(Number.parseFloat(dot(container).style.left)).toBeCloseTo(50, 0)
        expect(Number.parseFloat(dot(container).style.top)).toBeCloseTo(0, 0)

        const field = container.querySelector('.cursor-crosshair')
        if (!(field instanceof HTMLElement)) throw new Error('missing selection field')
        field.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
        fireEvent.pointerDown(field, { clientX: 25, clientY: 0 })
        expect(onChange).toHaveBeenLastCalledWith('#ffbfbf')

        fireEvent.pointerMove(window, { clientX: 60, clientY: 100 })
        fireEvent.pointerUp(window)
        expect(onChange).toHaveBeenLastCalledWith('#000000')
        expect(dot(container)).toHaveStyle({ left: '60%', top: '100%' })
    })

    it('names the hue and alpha sliders on the focusable input', () => {
        render(
            <ColorPicker value="#00ffff80">
                <ColorPickerHue />
                <ColorPickerAlpha />
            </ColorPicker>
        )
        // Base UI keeps edge-aligned thumbs invisible until it measures layout, which happy-dom never does,
        // so a name lookup can't see the range input; check its attributes instead.
        const hue = screen.getByRole('group', { name: 'Hue' }).querySelector('input[type="range"]')
        const alpha = screen.getByRole('group', { name: 'Alpha' }).querySelector('input[type="range"]')
        expect(hue).toHaveAttribute('aria-label', 'Hue')
        expect(hue).toHaveAttribute('aria-valuetext', '180°')
        expect(alpha).toHaveAttribute('aria-label', 'Alpha')
        expect(alpha).toHaveAttribute('aria-valuetext', '50%')
    })

    it('marks keyboard focus on the square and the slider thumbs with a full-strength ring', () => {
        const { container } = render(
            <ColorPicker value="#00ffff80">
                <ColorPickerSelection />
                <ColorPickerHue />
                <ColorPickerAlpha />
            </ColorPicker>
        )
        const square = screen.getByRole('slider', { name: 'Saturation and brightness' })
        const thumbs = [...container.querySelectorAll<HTMLElement>('[data-slot="slider-thumb"]')]
        expect(thumbs).toHaveLength(2)

        // A see-through ring (ring-ring/24) measured well under 3:1 on the popover.
        for (const part of [square, ...thumbs]) {
            const rings = part.className.split(/\s+/).filter((name) => /ring-ring\b/.test(name))
            expect(rings.length, part.className).toBeGreaterThan(0)
            expect(
                rings.filter((name) => name.includes('/')),
                part.className
            ).toEqual([])
            // A plain outline-hidden leaves a transparent outline at rest, which Windows Contrast themes paint.
            expect(part.className.split(/\s+/), part.className).not.toContain('outline-hidden')
        }
    })

    it('lets the keyboard move around the saturation/brightness square', () => {
        const onChange = vi.fn()
        render(
            <ColorPicker value="#ff0000" onChange={onChange}>
                <ColorPickerSelection />
            </ColorPicker>
        )
        const square = screen.getByRole('slider', { name: 'Saturation and brightness' })
        expect(square).toHaveAttribute('tabindex', '0')
        expect(square).toHaveAttribute('aria-valuetext', 'Saturation 100%, brightness 100%')

        fireEvent.keyDown(square, { key: 'ArrowLeft' })
        expect(square).toHaveAttribute('aria-valuetext', 'Saturation 99%, brightness 100%')
        expect(onChange).toHaveBeenLastCalledWith('#ff0303')

        fireEvent.keyDown(square, { key: 'ArrowDown', shiftKey: true })
        expect(square).toHaveAttribute('aria-valuetext', 'Saturation 99%, brightness 90%')

        fireEvent.keyDown(square, { key: 'End' })
        expect(onChange).toHaveBeenLastCalledWith('#e60000')
        fireEvent.keyDown(square, { key: 'ArrowUp', shiftKey: true })
        fireEvent.keyDown(square, { key: 'ArrowRight' })
        expect(square).toHaveAttribute('aria-valuetext', 'Saturation 100%, brightness 100%')

        fireEvent.keyDown(square, { key: 'Home' })
        expect(onChange).toHaveBeenLastCalledWith('#ffffff')

        onChange.mockClear()
        fireEvent.keyDown(square, { key: 'a' })
        expect(onChange).not.toHaveBeenCalled()
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
