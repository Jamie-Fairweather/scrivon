'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

type SwitchSettingProps = {
    label: ReactNode
    description?: ReactNode
    checked: boolean
    onChange: (checked: boolean) => void
    className?: string
}

/** Label (and optional description) on the left, switch on the right. */
export function SwitchSetting({ label, description, checked, onChange, className }: SwitchSettingProps) {
    return (
        <Field>
            {/* w-full: a Field only sizes its children to their content, which left each switch at a different spot. */}
            <div className={cn('flex w-full items-center justify-between gap-4', className)}>
                <div className="min-w-0 flex-1">
                    <FieldLabel>{label}</FieldLabel>
                    {description ? <FieldDescription>{description}</FieldDescription> : null}
                </div>
                <Switch checked={checked} onCheckedChange={(next) => onChange(next === true)} />
            </div>
        </Field>
    )
}
