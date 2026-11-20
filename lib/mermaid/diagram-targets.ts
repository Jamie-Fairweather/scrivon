/**
 * The parts of a drawn diagram that can be picked on the canvas: flowchart and state nodes, subgraphs (and composite
 * states) and links, and sequence participants and messages. They are read from the SVG string beautiful-mermaid
 * drew, which tags each part (`g.node[data-id]`, `polyline.edge[data-from][data-to]` and so on), with a DOMParser
 * document, which runs no scripts and is never added to the page. The picture itself stays in its sandboxed frame:
 * the canvas only draws an outline of its own on top, from the boxes and lines worked out here.
 *
 * Every box and line is in the picture's own pixels, from its top-left corner, as the frame draws it.
 */

export type Point = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }

/** `group` is a flowchart subgraph or a composite state; `actor` a sequence participant or actor. */
export type DiagramTargetKind = 'node' | 'group' | 'edge' | 'actor' | 'message'

export type DiagramTarget = {
    kind: DiagramTargetKind
    /** The part's id in the diagram's text, for a node, group or actor. Empty for an edge or message. */
    id: string
    /** The ids an edge or message joins. Empty for the other kinds. */
    from: string
    to: string
    /** The text drawn on it: a node's label, an edge's or message's label. Empty when it has none. */
    label: string
    /** For an edge or message, how many between the same two parts come before it in the picture. 0 for the others. */
    occurrence: number
    /** Around everything drawn for it. */
    box: Box
    /** Areas that pick it: a node's shape, an edge's label. */
    areas: readonly Box[]
    /** Lines that pick it when the pointer is close: an edge, a message's arrow. */
    lines: readonly (readonly Point[])[]
}

export type DiagramTargets = {
    /** The picture's size, as the frame draws it. */
    width: number
    height: number
    targets: readonly DiagramTarget[]
}

const NO_TARGETS: DiagramTargets = { width: 0, height: 0, targets: [] }

/** How close, in screen pixels, the pointer must come to a line to pick it, so thin links are easy to hit. */
export const LINE_HIT_SLOP_PX = 4

/** How far an outline sits outside the part it shows, in the picture's pixels. */
const OUTLINE_GAP = 3

/** The pan and zoom of the canvas (use-pan-zoom.ts): the shift from centre, in screen pixels, and the scale. */
export type CanvasView = { x: number; y: number; scale: number }

/** The canvas's box on screen, as getBoundingClientRect gives it. */
export type ScreenBox = { left: number; top: number; width: number; height: number }

// ---------------------------------------------------------------------------------------------------------------
// Reading the SVG

/** A 2D affine transform [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f. */
type Matrix = readonly [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

function multiply(m: Matrix, n: Matrix): Matrix {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

function apply(m: Matrix, { x, y }: Point): Point {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function numbers(text: string | null): number[] {
    return text ? (text.match(NUMBER) ?? []).map(Number) : []
}

/** An element's `transform`: translate, scale and matrix, which are all beautiful-mermaid writes. Others are left out. */
function parseTransform(text: string | null): Matrix {
    if (!text) return IDENTITY
    let result = IDENTITY
    for (const [, name, args] of text.matchAll(/(translate|scale|matrix)\s*\(([^)]*)\)/g)) {
        const n = numbers(args!)
        if (name === 'translate') result = multiply(result, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0])
        else if (name === 'scale') result = multiply(result, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0])
        else if (n.length === 6) result = multiply(result, n as unknown as Matrix)
    }
    return result
}

function attr(element: Element, name: string): number {
    const value = parseFloat(element.getAttribute(name) ?? '')
    return Number.isFinite(value) ? value : 0
}

function pairs(values: number[]): Point[] {
    const points: Point[] = []
    for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i]!, y: values[i + 1]! })
    return points
}

/** The points a path passes through or bends towards (its end points and control points), enough for a box around it. */
function pathPoints(d: string): Point[] {
    const points: Point[] = []
    let current: Point = { x: 0, y: 0 }
    let start: Point = current
    for (const [, command, args] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
        const upper = command!.toUpperCase()
        const relative = command !== upper
        const n = numbers(args!)
        const to = (x: number, y: number): Point => (relative ? { x: current.x + x, y: current.y + y } : { x, y })
        if (upper === 'Z') {
            current = start
        } else if (upper === 'H') {
            for (const x of n) points.push((current = { x: relative ? current.x + x : x, y: current.y }))
        } else if (upper === 'V') {
            for (const y of n) points.push((current = { x: current.x, y: relative ? current.y + y : y }))
        } else if (upper === 'A') {
            for (let i = 0; i + 6 < n.length; i += 7) points.push((current = to(n[i + 5]!, n[i + 6]!)))
        } else {
            // M, L and T take one point a step, S and Q two, C three. A step's last point is where the pen ends up.
            const step = upper === 'C' ? 6 : upper === 'S' || upper === 'Q' ? 4 : 2
            for (let i = 0; i + step - 1 < n.length; i += step) {
                const stepPoints: Point[] = []
                for (let j = 0; j < step; j += 2) stepPoints.push(to(n[i + j]!, n[i + j + 1]!))
                points.push(...stepPoints)
                current = stepPoints[stepPoints.length - 1]!
                if (upper === 'M' && i === 0) start = current
            }
        }
    }
    return points
}

/** A rough box for a text, which DOMParser can't measure: about 0.6 em a character, centred on its y as drawn. */
function textBox(element: Element): Box {
    const size = attr(element, 'font-size') || 13
    const width = Math.max(1, (element.textContent ?? '').length) * size * 0.6
    const height = size * 1.3
    const anchor = element.getAttribute('text-anchor')
    const x = attr(element, 'x') - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0)
    return { x, y: attr(element, 'y') - height / 2, width, height }
}

/** The points that bound one shape, in its own coordinates. */
function shapePoints(element: Element): Point[] {
    switch (element.localName) {
        case 'rect': {
            const x = attr(element, 'x')
            const y = attr(element, 'y')
            return [
                { x, y },
                { x: x + attr(element, 'width'), y: y + attr(element, 'height') },
            ]
        }
        case 'circle':
        case 'ellipse': {
            const cx = attr(element, 'cx')
            const cy = attr(element, 'cy')
            const rx = element.localName === 'circle' ? attr(element, 'r') : attr(element, 'rx')
            const ry = element.localName === 'circle' ? rx : attr(element, 'ry')
            return [
                { x: cx - rx, y: cy - ry },
                { x: cx + rx, y: cy + ry },
            ]
        }
        case 'line':
            return [
                { x: attr(element, 'x1'), y: attr(element, 'y1') },
                { x: attr(element, 'x2'), y: attr(element, 'y2') },
            ]
        case 'polygon':
        case 'polyline':
            return pairs(numbers(element.getAttribute('points')))
        case 'path':
            return pathPoints(element.getAttribute('d') ?? '')
        case 'text': {
            const box = textBox(element)
            return [
                { x: box.x, y: box.y },
                { x: box.x + box.width, y: box.y + box.height },
            ]
        }
        default:
            return []
    }
}

const SHAPES = 'rect, circle, ellipse, line, polygon, polyline, path'

/** Everything between `root` and `element` that moves it: the transforms of `root`, the groups in between and `element`. */
function transformWithin(root: Element, element: Element, base: Matrix): Matrix {
    const chain: Element[] = []
    for (let at: Element | null = element; at && at !== root; at = at.parentElement) chain.push(at)
    chain.push(root)
    let matrix = base
    for (const node of chain.reverse()) matrix = multiply(matrix, parseTransform(node.getAttribute('transform')))
    return matrix
}

function boxAround(points: readonly Point[]): Box | null {
    if (points.length === 0) return null
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const { x, y } of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
    }
    return minX <= maxX ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}

function unionBoxes(boxes: readonly Box[]): Box | null {
    return boxAround(
        boxes.flatMap((b) => [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
        ])
    )
}

/** The box around the matching elements inside `root` (and `root` itself, when it matches), placed by `base`. */
function boxOf(root: Element, selector: string, base: Matrix): Box | null {
    const elements = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)]
    const points = elements.flatMap((element) => {
        const matrix = transformWithin(root, element, base)
        return shapePoints(element).map((point) => apply(matrix, point))
    })
    return boxAround(points)
}

/** A node or group: its shapes, or its text when it draws none. A sequence actor: its icon and its name together. */
function partBox(element: Element, base: Matrix, withText: boolean): Box | null {
    if (withText) return boxOf(element, `${SHAPES}, text`, base)
    return boxOf(element, SHAPES, base) ?? boxOf(element, 'text', base)
}

/** `base` followed by the transforms of the groups around `element`, up to the picture's root. */
function placeIn(svg: Element, element: Element, base: Matrix): Matrix {
    const parents: Element[] = []
    for (let at = element.parentElement; at && at !== svg; at = at.parentElement) parents.push(at)
    let matrix = base
    for (const parent of parents.reverse()) matrix = multiply(matrix, parseTransform(parent.getAttribute('transform')))
    return matrix
}

function linePoints(element: Element, base: Matrix, root: Element): Point[] {
    const matrix = transformWithin(root, element, base)
    return shapePoints(element).map((point) => apply(matrix, point))
}

/** Where the picture's own coordinates land in the frame: its viewBox shifted to the corner, scaled to its width. */
function viewMatrix(svg: Element, width: number, height: number): Matrix {
    const box = numbers(svg.getAttribute('viewBox'))
    if (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0) return IDENTITY
    const sx = width > 0 ? width / box[2]! : 1
    const sy = height > 0 ? height / box[3]! : 1
    return [sx, 0, 0, sy, -box[0]! * sx, -box[1]! * sy]
}

function parseSvg(svg: string): Element | null {
    if (typeof DOMParser === 'undefined') return null
    const parser = new DOMParser()
    // As XML first, which reads the SVG exactly; as HTML when that fails (an `&` the renderer left in a style, say).
    const xml = parser.parseFromString(svg, 'image/svg+xml')
    const root = xml.querySelector('parsererror') ? null : xml.documentElement
    if (root?.localName === 'svg') return root
    return parser.parseFromString(svg, 'text/html').querySelector('svg')
}

function pairKey(from: string, to: string): string {
    return `${from}\u0000${to}`
}

/** Counts each pair as it comes, so the nth edge or message between the same two parts gets n - 1. */
function occurrenceCounter() {
    const counts = new Map<string, number>()
    return (from: string, to: string) => {
        const key = pairKey(from, to)
        const n = counts.get(key) ?? 0
        counts.set(key, n + 1)
        return n
    }
}

/** State diagram start and end points (`[*]`) are drawn as nodes, but aren't parts to pick. */
function isPseudoState(element: Element): boolean {
    const shape = element.getAttribute('data-shape')
    return shape === 'state-start' || shape === 'state-end'
}

function readTargets(svg: string): DiagramTargets {
    const root = parseSvg(svg)
    if (!root) return NO_TARGETS
    const box = numbers(root.getAttribute('viewBox'))
    const width = attr(root, 'width') || box[2] || 0
    const height = attr(root, 'height') || box[3] || 0
    const base = viewMatrix(root, width, height)
    const targets: DiagramTarget[] = []
    const data = (element: Element, name: string) => element.getAttribute(`data-${name}`) ?? ''

    const at = (element: Element) => placeIn(root, element, base)

    for (const element of root.querySelectorAll('g.subgraph[data-id]')) {
        const area = partBox(element, at(element), false)
        if (area)
            targets.push({
                kind: 'group',
                id: data(element, 'id'),
                from: '',
                to: '',
                label: data(element, 'label'),
                occurrence: 0,
                box: area,
                areas: [area],
                lines: [],
            })
    }

    for (const element of root.querySelectorAll('g.node[data-id]')) {
        if (isPseudoState(element)) continue
        const area = partBox(element, at(element), false)
        if (area)
            targets.push({
                kind: 'node',
                id: data(element, 'id'),
                from: '',
                to: '',
                label: data(element, 'label'),
                occurrence: 0,
                box: area,
                areas: [area],
                lines: [],
            })
    }

    // An edge's label is drawn apart from its line. The nth label for a pair and text goes with the nth edge that has them.
    const labels = new Map<string, Box[]>()
    for (const element of root.querySelectorAll('g.edge-label[data-from][data-to]')) {
        const area = boxOf(element, 'rect', at(element)) ?? boxOf(element, 'text', at(element))
        if (!area) continue
        const key = pairKey(pairKey(data(element, 'from'), data(element, 'to')), data(element, 'label'))
        labels.set(key, [...(labels.get(key) ?? []), area])
    }
    const nextEdge = occurrenceCounter()
    for (const element of root.querySelectorAll('polyline.edge[data-from][data-to]')) {
        const from = data(element, 'from')
        const to = data(element, 'to')
        const label = data(element, 'label')
        const line = linePoints(element, at(element), element)
        const labelArea = label ? labels.get(pairKey(pairKey(from, to), label))?.shift() : undefined
        const areas = labelArea ? [labelArea] : []
        const around = unionBoxes([...(boxAround(line) ? [boxAround(line)!] : []), ...areas])
        if (around) targets.push({ kind: 'edge', id: '', from, to, label, occurrence: nextEdge(from, to), box: around, areas, lines: [line] })
    }

    for (const element of root.querySelectorAll('g.actor[data-id]')) {
        const area = partBox(element, at(element), true)
        if (area)
            targets.push({
                kind: 'actor',
                id: data(element, 'id'),
                from: '',
                to: '',
                label: data(element, 'label'),
                occurrence: 0,
                box: area,
                areas: [area],
                lines: [],
            })
    }

    const nextMessage = occurrenceCounter()
    for (const element of root.querySelectorAll('g.message[data-from][data-to]')) {
        const from = data(element, 'from')
        const to = data(element, 'to')
        const lines = [...element.querySelectorAll('line, polyline')].map((line) => linePoints(line, at(element), element))
        const text = boxOf(element, 'text', at(element))
        const areas = text ? [text] : []
        const around = unionBoxes([...lines.map(boxAround).filter((b): b is Box => b !== null), ...areas])
        if (around)
            targets.push({
                kind: 'message',
                id: '',
                from,
                to,
                label: data(element, 'label'),
                occurrence: nextMessage(from, to),
                box: around,
                areas,
                lines,
            })
    }

    return { width, height, targets }
}

/** Kept for the last few pictures, so the canvas and the palette share one reading of each. */
const MAX_CACHED = 8
const cache = new Map<string, DiagramTargets>()

/** The parts of the picture drawn by this SVG string. Worked out once per string; the same object comes back after. */
export function readDiagramTargets(svg: string): DiagramTargets {
    const cached = cache.get(svg)
    if (cached) {
        cache.delete(svg)
        cache.set(svg, cached)
        return cached
    }
    let result: DiagramTargets
    try {
        result = readTargets(svg)
    } catch {
        result = NO_TARGETS
    }
    cache.set(svg, result)
    for (const oldest of cache.keys()) {
        if (cache.size <= MAX_CACHED) break
        cache.delete(oldest)
    }
    return result
}

// ---------------------------------------------------------------------------------------------------------------
// Picking

/**
 * Where a point on screen falls on the picture, in its own pixels. The picture is centred in the canvas and moved
 * and scaled about its centre by the canvas's view (use-pan-zoom.ts).
 */
export function toDiagramPoint(client: Point, canvas: ScreenBox, view: CanvasView, size: { width: number; height: number }): Point {
    const centreX = canvas.left + canvas.width / 2
    const centreY = canvas.top + canvas.height / 2
    const scale = view.scale > 0 ? view.scale : 1
    return {
        x: (client.x - centreX - view.x) / scale + size.width / 2,
        y: (client.y - centreY - view.y) / scale + size.height / 2,
    }
}

function contains(box: Box, { x, y }: Point, slop = 0): boolean {
    return x >= box.x - slop && x <= box.x + box.width + slop && y >= box.y - slop && y <= box.y + box.height + slop
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function distanceToLine(p: Point, line: readonly Point[]): number {
    if (line.length === 1) return Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y)
    let best = Infinity
    for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i - 1]!, line[i]!))
    return best
}

/**
 * The part at a point of the picture (in its own pixels), at a zoom of `scale`. Where parts overlap, the smallest
 * wins, so a node inside a subgraph is picked over the subgraph, and a line close by over the box it crosses. Lines
 * pick within LINE_HIT_SLOP_PX screen pixels, whatever the zoom. Null over empty canvas.
 */
export function targetAtPoint(targets: readonly DiagramTarget[], point: Point, scale: number): DiagramTarget | null {
    const slop = LINE_HIT_SLOP_PX / (scale > 0 ? scale : 1)
    let best: DiagramTarget | null = null
    let bestSize = Infinity
    let bestDistance = Infinity
    for (const target of targets) {
        if (!contains(target.box, point, slop)) continue
        let size = Infinity
        let distance = Infinity
        for (const line of target.lines) {
            const d = distanceToLine(point, line)
            if (d <= slop && d < distance) {
                size = 0
                distance = d
            }
        }
        for (const area of target.areas) {
            if (!contains(area, point)) continue
            const areaSize = area.width * area.height
            if (areaSize < size) {
                size = areaSize
                distance = 0
            }
        }
        if (size < bestSize || (size === bestSize && distance < bestDistance)) {
            best = target
            bestSize = size
            bestDistance = distance
        }
    }
    return best
}

/** The part under a point on screen, from the canvas's box and view (see toDiagramPoint and targetAtPoint). */
export function pickDiagramTarget(diagram: DiagramTargets, client: Point, canvas: ScreenBox, view: CanvasView): DiagramTarget | null {
    if (diagram.targets.length === 0) return null
    return targetAtPoint(diagram.targets, toDiagramPoint(client, canvas, view, diagram), view.scale)
}

function round(n: number): string {
    return String(Math.round(n * 100) / 100)
}

function rectPath({ x, y, width, height }: Box, gap: number): string {
    const left = round(x - gap)
    const top = round(y - gap)
    const right = round(x + width + gap)
    const bottom = round(y + height + gap)
    return `M${left} ${top}H${right}V${bottom}H${left}Z`
}

/**
 * The outline that shows a part is about to be picked, as one SVG path: a box around a node, group or actor, and
 * the line (and label box) of an edge or message.
 */
export function targetOutlinePath(target: DiagramTarget): string {
    if (target.lines.length === 0) return rectPath(target.box, OUTLINE_GAP)
    const lines = target.lines
        .filter((line) => line.length > 0)
        .map((line) => line.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(''))
    return [...lines, ...target.areas.map((area) => rectPath(area, 1))].join('')
}
