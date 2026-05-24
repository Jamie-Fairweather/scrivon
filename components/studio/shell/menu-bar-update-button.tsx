'use client'

import { ArrowDownCircle } from 'lucide-react'
import { useAppUpdate } from '@/components/studio/app-update-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function MenuBarUpdateButton() {
    const { update, openUpdateDialog } = useAppUpdate()

    if (!update) return null

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="relative ms-0.5 text-foreground/90"
            aria-label={`Update available: version ${update.version}`}
            title={`Update ${update.version} available`}
            onClick={openUpdateDialog}
        >
            <ArrowDownCircle className="size-4" />
            <span aria-hidden className={cn('absolute end-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background')} />
        </Button>
    )
}
