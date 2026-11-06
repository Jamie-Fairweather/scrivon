/**
 * Tight bounds of visible SVG content, in SVG user units. Never measured: the diagram frames are
 * sandboxed, so their document can't be read. Kept only for embedded-mermaid-block's leftover
 * state; remove together with DiagramIframe's ignored bounds props.
 */
export type SvgContentBounds = {
    width: number
    height: number
    offsetX: number
    offsetY: number
}
