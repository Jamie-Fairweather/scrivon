/** Tight bounds of visible SVG content (from getBBox), in SVG user units. */
export type SvgContentBounds = {
    width: number
    height: number
    offsetX: number
    offsetY: number
}

export function measureSvgContentBounds(svg: SVGSVGElement): SvgContentBounds | null {
    try {
        const box = svg.getBBox()
        if (box.width > 0 && box.height > 0) {
            return { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y }
        }
    } catch {
        // getBBox can throw when SVG is not rendered yet
    }
    return null
}
