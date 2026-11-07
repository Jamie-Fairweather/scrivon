import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiagramIframe, SWAP_FALLBACK_MS } from '@/lib/mermaid/svg-iframe'

const svgOf = (label: string, width = 100) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 50" width="${width}" height="50"><text>${label}</text></svg>`

const frames = () => screen.queryAllByTitle('Diagram preview') as HTMLIFrameElement[]

afterEach(() => {
    vi.useRealTimers()
})

describe('DiagramIframe', () => {
    it('draws one frame, sandboxed with no scripts', () => {
        render(<DiagramIframe svg={svgOf('A')} />)

        expect(frames()).toHaveLength(1)
        const sandbox = frames()[0].getAttribute('sandbox')
        expect(sandbox).toBe('')
        expect(sandbox).not.toMatch(/allow-scripts/)
    })

    it('loads a new diagram in a hidden frame and shows it once that frame has loaded', async () => {
        const { rerender } = render(<DiagramIframe svg={svgOf('A')} />)
        rerender(<DiagramIframe svg={svgOf('B', 200)} />)

        const [shown, incoming] = frames()
        expect(frames()).toHaveLength(2)
        expect(shown.srcdoc).toContain('>A<')
        expect(incoming.srcdoc).toContain('>B<')
        expect(incoming.style.opacity).toBe('0')

        fireEvent.load(incoming)

        await waitFor(() => expect(frames()).toHaveLength(1))
        // The loaded frame takes over as is, so it isn't reloaded.
        expect(frames()[0]).toBe(incoming)
        expect(incoming.style.opacity).toBe('1')
        expect(screen.getByRole('img').style.width).toBe('200px')
    })

    it('shows the new diagram anyway if its frame never reports loading', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { rerender } = render(<DiagramIframe svg={svgOf('A')} />)
        rerender(<DiagramIframe svg={svgOf('B')} />)

        act(() => vi.advanceTimersByTime(SWAP_FALLBACK_MS - 1))
        expect(frames()).toHaveLength(2)

        act(() => vi.advanceTimersByTime(1))
        expect(frames()).toHaveLength(1)
        expect(frames()[0].srcdoc).toContain('>B<')
    })

    it('drops a diagram that was replaced before it loaded', async () => {
        const { rerender } = render(<DiagramIframe svg={svgOf('A')} />)
        rerender(<DiagramIframe svg={svgOf('B')} />)
        const stale = frames()[1]
        rerender(<DiagramIframe svg={svgOf('C')} />)

        expect(frames()).toHaveLength(2)
        expect(frames()[1].srcdoc).toContain('>C<')

        fireEvent.load(stale)
        fireEvent.load(frames()[1])
        await waitFor(() => expect(frames()).toHaveLength(1))
        expect(frames()[0].srcdoc).toContain('>C<')
    })

    it('stops loading when the text goes back to the diagram already shown', () => {
        const { rerender } = render(<DiagramIframe svg={svgOf('A')} />)
        rerender(<DiagramIframe svg={svgOf('B')} />)
        rerender(<DiagramIframe svg={svgOf('A')} />)

        expect(frames()).toHaveLength(1)
        expect(frames()[0].srcdoc).toContain('>A<')
    })
})
