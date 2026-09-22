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
            <div className={cn('flex items-center justify-between gap-4', className)}>
                <div>
                    <FieldLabel>{label}</FieldLabel>
                    {description ? <FieldDescription>{description}</FieldDescription> : null}
                </div>
                <Switch checked={checked} onCheckedChange={(next) => onChange(next === true)} />
            </div>
        </Field>
    )
}
