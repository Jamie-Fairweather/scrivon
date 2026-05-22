export function getSvgDimensions(svg: string): { width: number; height: number } | null {
    const viewBoxMatch = svg.match(/viewBox=["']([^"']+)["']/i)
    if (viewBoxMatch) {
        const parts = viewBoxMatch[1]
            .trim()
            .split(/[\s,]+/)
            .map(Number)
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] }
        }
    }

    const widthMatch = svg.match(/\bwidth=["']([^"']+)["']/i)
    const heightMatch = svg.match(/\bheight=["']([^"']+)["']/i)
    if (widthMatch && heightMatch) {
        const width = parseFloat(widthMatch[1])
        const height = parseFloat(heightMatch[1])
        if (width > 0 && height > 0) {
            return { width, height }
        }
    }

    return null
}
