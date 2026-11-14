import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalError from '@/app/global-error'
import { logError } from '@/lib/diagnostics/app-log'

vi.mock('@/lib/diagnostics/app-log', () => ({ logError: vi.fn(), logWarning: vi.fn() }))

// app/ has no test project of its own, so the root error screen is tested here with the other crash screens.
describe('GlobalError', () => {
    let root: Root | null = null

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const html = document.documentElement
        html.className = 'h-full overflow-hidden font-var-sans font-var-mono dark'
        html.setAttribute('style', '--background: #101010; --foreground: #fafafa;')
        html.dataset.appTheme = 'scrivon-dark'
    })

    afterEach(() => {
        act(() => root?.unmount())
        root = null
        vi.restoreAllMocks()
    })

    it("keeps the layout's fonts and theme on <html> when it replaces the root layout", () => {
        act(() => {
            root = createRoot(document)
            root.render(<GlobalError error={new Error('Settings exploded')} reset={() => {}} />)
        })

        const html = document.documentElement
        expect(html).toHaveClass('font-var-sans', 'font-var-mono', 'dark', 'h-full')
        expect(html.style.getPropertyValue('--background')).toBe('#101010')
        expect(html.dataset.appTheme).toBe('scrivon-dark')
        expect(document.body).toHaveTextContent('Settings exploded')
        expect(logError).toHaveBeenCalledWith('Scrivon hit an error while rendering', new Error('Settings exploded'))
    })
})
