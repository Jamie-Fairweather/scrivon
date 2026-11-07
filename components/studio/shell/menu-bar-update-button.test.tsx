import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const openUpdateDialog = vi.fn()

vi.mock('@/components/studio/app-update-provider', () => ({
    useAppUpdate: () => ({ update: { version: '1.4.0' }, openUpdateDialog }),
}))

const { MenuBarUpdateButton } = await import('./menu-bar-update-button')

describe('MenuBarUpdateButton', () => {
    it('says which update is ready in a tooltip that also shows on keyboard focus', async () => {
        render(<MenuBarUpdateButton />)
        const button = screen.getByRole('button', { name: 'Update available: version 1.4.0' })
        expect(button).not.toHaveAttribute('title')

        act(() => button.focus())
        expect(await screen.findByText('Update 1.4.0 available')).toBeInTheDocument()

        fireEvent.click(button)
        expect(openUpdateDialog).toHaveBeenCalledTimes(1)
    })
})
