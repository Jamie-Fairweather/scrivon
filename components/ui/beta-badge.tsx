import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Marks a feature that works but may still have rough edges. Screen readers hear "Beta" as part of the label. */
export function BetaBadge({ className }: { className?: string }) {
    return (
        <Badge variant="info" size="sm" className={cn('px-1', className)}>
            Beta
        </Badge>
    )
}
