'use client'

import './globals.css'
import { useEffect, useLayoutEffect, useState } from 'react'
import { formatErrorDetails, StudioReloadFallback } from '@/components/studio/shell/studio-error-boundary'
import { APP_NAME } from '@/lib/app-branding'
import { logError } from '@/lib/diagnostics/app-log'

type RootAttributes = { className: string; others: [name: string, value: string][] }

/**
 * The root layout's <html> attributes: the font variable classes, the theme's `dark` class and its
 * inline colours. React clears them all when this screen replaces the layout's <html>, which would
 * leave a light screen in the browser's serif font. Rendering runs before that, so read them here.
 */
function readRootAttributes(): RootAttributes | null {
    if (typeof document === 'undefined') return null
    const root = document.documentElement
    const others = Array.from(root.attributes)
        .filter((attr) => attr.name !== 'class' && attr.name !== 'lang')
        .map((attr): [string, string] => [attr.name, attr.value])
    return { className: root.className, others }
}

/** Last-resort screen for errors in the root layout (settings, theme), keeping the window controls usable. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    const [rootAttributes] = useState(readRootAttributes)

    // Put back the inline theme colours (and anything else) the layout had on <html>.
    useLayoutEffect(() => {
        for (const [name, value] of rootAttributes?.others ?? []) {
            document.documentElement.setAttribute(name, value)
        }
    }, [rootAttributes])

    useEffect(() => logError(`${APP_NAME} hit an error while rendering`, error), [error])

    return (
        // Joined, not merged with cn(): tailwind-merge could drop one of the layout's class names.
        <html lang="en" className={['h-full overflow-hidden', rootAttributes?.className].filter(Boolean).join(' ')} suppressHydrationWarning>
            <body className="h-full w-full overflow-hidden bg-background font-sans">
                <StudioReloadFallback error={error} details={formatErrorDetails(error)} reset={reset} />
            </body>
        </html>
    )
}
