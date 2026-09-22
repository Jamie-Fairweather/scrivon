import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
    it('renders a button and shows a spinner while loading', () => {
        const { rerender } = render(<Button className="extra">Save</Button>)
        const button = screen.getByRole('button', { name: 'Save' })
        expect(button).toHaveAttribute('type', 'button')
        expect(button).toHaveAttribute('data-slot', 'button')
        expect(button).not.toHaveAttribute('data-loading')
        expect(button).not.toHaveAttribute('aria-disabled')
        expect(button.className).toContain('extra')
        expect(screen.queryByRole('status')).toBeNull()

        rerender(
            <Button loading disabled>
                Save
            </Button>
        )
        const loading = screen.getByRole('button', { name: 'Save Loading' })
        expect(loading).toBeDisabled()
        expect(loading).toHaveAttribute('data-loading', '')
        expect(loading).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    })

    it('can render as another element and honour disabled without loading', () => {
        const { rerender } = render(<Button render={<a href="#next" />}>Next</Button>)
        const link = screen.getByRole('link', { name: 'Next' })
        expect(link).toHaveAttribute('href', '#next')
        expect(link).not.toHaveAttribute('type')

        rerender(<Button disabled>Next</Button>)
        expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
        expect(screen.queryByRole('status')).toBeNull()
    })
})
