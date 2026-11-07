import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Slider, SliderValue } from '@/components/ui/slider'

function thumbCount(ui: ReactElement): number {
    const view = render(ui)
    const count = document.querySelectorAll('[data-slot="slider-thumb"]').length
    view.unmount()
    return count
}

describe('Slider', () => {
    it('renders a thumb for a controlled array, a single value, and defaults', () => {
        const view = render(
            <Slider className="extra" value={[10, 30]}>
                <SliderValue className="value" />
            </Slider>
        )
        expect(document.querySelectorAll('[data-slot="slider-thumb"]')).toHaveLength(2)
        expect(document.querySelector('[data-slot="slider-value"]')?.className).toContain('value')
        view.unmount()

        expect(thumbCount(<Slider value={15} max={50} />)).toBe(1)
        expect(thumbCount(<Slider defaultValue={[5, 6]} />)).toBe(2)
        expect(thumbCount(<Slider defaultValue={7} />)).toBe(1)
        expect(thumbCount(<Slider />)).toBe(1)
        expect(thumbCount(<Slider min={4} max={10} />)).toBe(1)
    })
})
