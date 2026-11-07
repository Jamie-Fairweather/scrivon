/**
 * Inline text links. Always underlined, because colour alone doesn't mark a link (WCAG 1.4.1); the underline
 * gets stronger on hover, and keyboard focus shows a clear ring.
 */
export const inlineLinkClassName =
    'rounded-sm text-info-foreground underline decoration-info-foreground/40 underline-offset-4 transition-colors hover:decoration-info-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
