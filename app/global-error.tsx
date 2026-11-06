'use client'

import './globals.css'
import { formatErrorDetails, StudioReloadFallback } from '@/components/studio/shell/studio-error-boundary'

/** Last-resort screen for errors in the root layout (settings, theme), keeping the window controls usable. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html lang="en" className="h-full overflow-hidden">
            <body className="h-full w-full overflow-hidden bg-background font-sans">
                <StudioReloadFallback error={error} details={formatErrorDetails(error)} reset={reset} />
            </body>
        </html>
    )
}
