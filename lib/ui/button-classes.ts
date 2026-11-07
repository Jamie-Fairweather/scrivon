/**
 * For a ghost Button that toggles something on and off (with aria-pressed). On gets the full accent fill and text;
 * hovering a button that is off gets only half the fill, so hovering never makes it look more 'on' than a button
 * that really is. Windows Contrast Themes highlight aria-pressed="true" on their own (globals.css).
 */
export const toggleButtonClassName = 'hover:bg-accent/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:hover:bg-accent'

/**
 * For an outline Button that floats over a diagram. The outline variant's fill is see-through in dark themes, so
 * the diagram would show through it; this keeps it solid, with a shadow to lift it off the picture.
 */
export const overlayButtonClassName = 'shadow-sm dark:bg-popover'
