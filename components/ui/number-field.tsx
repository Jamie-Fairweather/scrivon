'use client'

import { NumberField as NumberFieldPrimitive } from '@base-ui/react/number-field'
import { MinusIcon, PlusIcon } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

export const NumberFieldContext: React.Context<{
    fieldId: string
} | null> = React.createContext<{
    fieldId: string
} | null>(null)

export function NumberField({
    id,
    className,
    size = 'default',
    ...props
}: NumberFieldPrimitive.Root.Props & {
    size?: 'sm' | 'default' | 'lg'
}): React.ReactElement {
    const generatedId = React.useId()
    const fieldId = id ?? generatedId

    return (
        <NumberFieldContext.Provider value={{ fieldId }}>
            <NumberFieldPrimitive.Root
                className={cn('flex w-full flex-col items-start gap-2', className)}
                data-size={size}
                data-slot="number-field"
                id={fieldId}
                {...props}
            />
        </NumberFieldContext.Provider>
    )
}

export function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props): React.ReactElement {
    return (
        <NumberFieldPrimitive.Group
            className={cn(
                `relative flex w-full justify-between rounded-lg border border-input bg-background text-base text-foreground shadow-xs/5 ring-ring/24
                transition-shadow not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0
                before:rounded-[calc(var(--radius-lg)-1px)]
                not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-within:border-ring
                focus-within:ring-[3px] has-autofill:bg-foreground/4 has-aria-invalid:border-destructive/36
                focus-within:has-aria-invalid:border-destructive/64 focus-within:has-aria-invalid:ring-destructive/48 sm:text-sm dark:bg-input/32
                dark:not-data-disabled:not-focus-within:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]
                dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 data-disabled:pointer-events-none data-disabled:opacity-64
                [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4
                [[data-disabled],:focus-within,[aria-invalid]]:shadow-none`,
                className
            )}
            data-slot="number-field-group"
            {...props}
        />
    )
}

export function NumberFieldDecrement({ className, ...props }: NumberFieldPrimitive.Decrement.Props): React.ReactElement {
    return (
        <NumberFieldPrimitive.Decrement
            className={cn(
                `relative flex shrink-0 cursor-pointer items-center justify-center rounded-s-[calc(var(--radius-lg)-1px)] px-[calc(--spacing(3)-1px)]
                transition-colors hover:bg-accent in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] pointer-coarse:after:absolute
                pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11`,
                className
            )}
            data-slot="number-field-decrement"
            {...props}
        >
            <MinusIcon />
        </NumberFieldPrimitive.Decrement>
    )
}

export function NumberFieldIncrement({ className, ...props }: NumberFieldPrimitive.Increment.Props): React.ReactElement {
    return (
        <NumberFieldPrimitive.Increment
            className={cn(
                `relative flex shrink-0 cursor-pointer items-center justify-center rounded-e-[calc(var(--radius-lg)-1px)] px-[calc(--spacing(3)-1px)]
                transition-colors hover:bg-accent in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] pointer-coarse:after:absolute
                pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11`,
                className
            )}
            data-slot="number-field-increment"
            {...props}
        >
            <PlusIcon />
        </NumberFieldPrimitive.Increment>
    )
}

export function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props): React.ReactElement {
    return (
        <NumberFieldPrimitive.Input
            className={cn(
                `h-8.5 w-full min-w-0 grow bg-transparent px-[calc(--spacing(3)-1px)] text-center leading-8.5 tabular-nums outline-none
                [transition:background-color_5000000s_ease-in-out_0s] in-data-[size=lg]:h-9.5 in-data-[size=lg]:leading-9.5 in-data-[size=sm]:h-7.5
                in-data-[size=sm]:px-[calc(--spacing(2.5)-1px)] in-data-[size=sm]:leading-7.5 sm:h-7.5 sm:leading-7.5 sm:in-data-[size=lg]:h-8.5
                sm:in-data-[size=lg]:leading-8.5 sm:in-data-[size=sm]:h-6.5 sm:in-data-[size=sm]:leading-8.5`,
                className
            )}
            data-slot="number-field-input"
            {...props}
        />
    )
}

export { NumberFieldPrimitive }
