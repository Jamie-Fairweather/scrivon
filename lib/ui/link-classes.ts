/**
 * Inline text links. Always underlined, because colour alone doesn't mark a link (WCAG 1.4.1); the underline
 * gets stronger on hover, and keyboard focus shows a clear ring.
 */
export const inlineLinkClassName =
    'rounded-sm text-info-foreground underline decoration-info-foreground/40 underline-offset-4 transition-colors hover:decoration-info-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * A link that leads nowhere Scrivon can find (a wiki link to a note the folder doesn't have). It differs by more than
 * colour: a dashed underline, in the muted text colour, which keeps its contrast in light and dark themes. Hover and
 * focus as for {@link inlineLinkClassName}.
 */
export const missingLinkClassName =
    'rounded-sm text-muted-foreground underline decoration-dashed decoration-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
