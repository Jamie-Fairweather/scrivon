import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { overlayButtonClassName, toggleButtonClassName } from './button-classes'

/** The classes a Button ends up with, as Button itself works them out. */
function buttonClasses(variant: 'ghost' | 'outline', className: string): string[] {
    return cn(buttonVariants({ variant, size: 'sm', className })).split(/\s+/)
}

describe('toggleButtonClassName (U32)', () => {
    it('makes a toggle that is on stronger than hovering one that is off', () => {
        const classes = buttonClasses('ghost', toggleButtonClassName)
        expect(classes).toEqual(
            expect.arrayContaining(['aria-pressed:bg-accent', 'aria-pressed:text-accent-foreground', 'aria-pressed:hover:bg-accent'])
        )
        // The ghost variant's full hover fill gives way to half of it.
        expect(classes).toContain('hover:bg-accent/50')
        expect(classes).not.toContain('hover:bg-accent')
    })
})

describe('overlayButtonClassName (U32)', () => {
    it('gives a button over a diagram a border and a solid fill in light and dark themes', () => {
        const classes = buttonClasses('outline', overlayButtonClassName)
        expect(classes).toEqual(expect.arrayContaining(['border-input', 'bg-popover', 'dark:bg-popover', 'shadow-sm']))
        // The outline variant's see-through dark fill and faint shadow are replaced, not stacked under.
        expect(classes).not.toContain('dark:bg-input/32')
        expect(classes).not.toContain('shadow-xs/5')
    })
})
