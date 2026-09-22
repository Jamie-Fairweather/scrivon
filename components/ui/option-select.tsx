'use client'

import type { ReactNode } from 'react'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'

export type SelectOption<T extends string> = { label: string; value: T }

type OptionSelectProps<T extends string> = {
    id?: string
    value: T
    options: SelectOption<T>[]
    onChange: (value: T) => void
    className?: string
    /** Custom item content; defaults to the option label. */
    renderOption?: (option: SelectOption<T>) => ReactNode
}

/** Single-value select over a fixed list of string options: the common case in settings forms. */
export function OptionSelect<T extends string>({ id, value, options, onChange, className, renderOption }: OptionSelectProps<T>) {
    return (
        <Select
            items={options}
            value={value}
            onValueChange={(next) => {
                if (next != null) onChange(next as T)
            }}
        >
            <SelectTrigger id={id} className={className}>
                <SelectValue />
            </SelectTrigger>
            <SelectPopup>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                        {renderOption ? renderOption(option) : option.label}
                    </SelectItem>
                ))}
            </SelectPopup>
        </Select>
    )
}
