import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { exampleTabId } from '@/lib/examples/example-tab'
import { ExamplesExplorer } from './examples-explorer'

const { tabs } = vi.hoisted(() => ({
    tabs: { activeTabId: null as string | null, openExample: vi.fn(async () => undefined) },
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useActiveTabId: () => tabs.activeTabId,
    useDocumentTabActions: () => tabs,
}))

const [first, second] = APP_EXAMPLES as [(typeof APP_EXAMPLES)[number], (typeof APP_EXAMPLES)[number]]
const exampleButton = (title: string) => screen.getAllByRole('button').find((button) => button.textContent === title)!

describe('ExamplesExplorer', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        tabs.activeTabId = null
    })

    it('marks the open example as current, and only that one', () => {
        tabs.activeTabId = exampleTabId(first.id)
        render(<ExamplesExplorer />)

        expect(exampleButton(first.title)).toHaveAttribute('aria-current', 'true')
        expect(exampleButton(second.title)).not.toHaveAttribute('aria-current')
    })

    it('opens an example when it is clicked', () => {
        render(<ExamplesExplorer />)
        fireEvent.click(exampleButton(second.title))
        expect(tabs.openExample).toHaveBeenCalledWith(second.id)
    })

    it('keeps the scroll box out of the Tab order when the list is long enough to scroll', async () => {
        // The test DOM lays nothing out, so every box is made taller inside than out, as a long list is.
        const sizes = [
            vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100),
            vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000),
            vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100),
            vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(100),
        ]
        try {
            render(<ExamplesExplorer />)
            const viewport = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement
            await waitFor(() => expect(viewport).toHaveAttribute('data-has-overflow-y'))

            expect(viewport.tabIndex).toBe(-1)
        } finally {
            for (const size of sizes) size.mockRestore()
        }
    })
})
