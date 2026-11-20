// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    LINE_HIT_SLOP_PX,
    pickDiagramTarget,
    readDiagramTargets,
    targetAtPoint,
    targetOutlinePath,
    toDiagramPoint,
    type DiagramTarget,
} from '@/lib/mermaid/diagram-targets'
import { renderMermaidDiagram } from '@/lib/mermaid/render'
import { locateDiagramTarget } from '@/lib/mermaid/source-locations'

const FLOWCHART = 'graph TD\n  subgraph S1 [Group]\n  A[Start] -->|yes| B\n  end\n  B --> C & D\n  A --> B'
const STATE =
    'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n  state "Long" as L\n  Busy --> L\n  L --> [*]\n  state Comp {\n    X --> Y\n  }'
const SEQUENCE = 'sequenceDiagram\n  participant A as Alice\n  actor B\n  A->>B: Hello\n  B-->>A: Reply\n  A->>B: Hello\n  A->>A: Think'

function center(target: DiagramTarget) {
    return { x: target.box.x + target.box.width / 2, y: target.box.y + target.box.height / 2 }
}

function find(targets: readonly DiagramTarget[], kind: DiagramTarget['kind'], name: string, occurrence = 0) {
    const found = targets.find((t) => t.kind === kind && (t.id === name || `${t.from}>${t.to}` === name) && t.occurrence === occurrence)
    if (!found) throw new Error(`no ${kind} ${name}`)
    return found
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('readDiagramTargets', () => {
    it('reads the nodes, subgraphs and links of a real flowchart', () => {
        const svg = renderMermaidDiagram(FLOWCHART, 'scrivon-light')
        const { width, height, targets } = readDiagramTargets(svg)

        expect(width).toBeGreaterThan(0)
        expect(height).toBeGreaterThan(0)
        expect(targets.filter((t) => t.kind === 'node').map((t) => [t.id, t.label])).toEqual(
            expect.arrayContaining([
                ['A', 'Start'],
                ['B', 'B'],
                ['C', 'C'],
                ['D', 'D'],
            ])
        )
        expect(find(targets, 'group', 'S1').label).toBe('Group')
        const edges = targets.filter((t) => t.kind === 'edge').map((t) => [t.from, t.to, t.occurrence, t.label])
        expect(edges).toEqual(
            expect.arrayContaining([
                ['A', 'B', 0, 'yes'],
                ['A', 'B', 1, ''],
                ['B', 'C', 0, ''],
                ['B', 'D', 0, ''],
            ])
        )
        // The labelled link is picked by its label box too.
        expect(find(targets, 'edge', 'A>B').areas).toHaveLength(1)
        expect(find(targets, 'edge', 'A>B', 1).areas).toHaveLength(0)
        // The node lies inside the subgraph's box.
        const group = find(targets, 'group', 'S1').box
        const node = find(targets, 'node', 'A').box
        expect(node.x).toBeGreaterThanOrEqual(group.x)
        expect(node.x + node.width).toBeLessThanOrEqual(group.x + group.width)
    })

    it('reads the states and transitions of a real state diagram, leaving out the start and end points', () => {
        const { targets } = readDiagramTargets(renderMermaidDiagram(STATE, 'scrivon-light'))

        const nodes = targets.filter((t) => t.kind === 'node').map((t) => t.id)
        expect(nodes).toEqual(expect.arrayContaining(['Idle', 'Busy', 'L', 'X', 'Y']))
        expect(nodes.some((id) => id.startsWith('_'))).toBe(false)
        expect(find(targets, 'node', 'L').label).toBe('Long')
        expect(find(targets, 'group', 'Comp').kind).toBe('group')
        expect(find(targets, 'edge', 'Idle>Busy').label).toBe('go')
        expect(find(targets, 'edge', '_start>Idle').kind).toBe('edge')
    })

    it('reads the participants and messages of a real sequence diagram', () => {
        const { targets } = readDiagramTargets(renderMermaidDiagram(SEQUENCE, 'scrivon-light'))

        expect(find(targets, 'actor', 'A').label).toBe('Alice')
        // An actor's box takes in its stick figure and its name.
        const actor = find(targets, 'actor', 'B').box
        expect(actor.width).toBeGreaterThan(20)
        expect(actor.height).toBeGreaterThan(40)
        const messages = targets.filter((t) => t.kind === 'message').map((t) => [t.from, t.to, t.occurrence, t.label])
        expect(messages).toEqual([
            ['A', 'B', 0, 'Hello'],
            ['B', 'A', 0, 'Reply'],
            ['A', 'B', 1, 'Hello'],
            ['A', 'A', 0, 'Think'],
        ])
        expect(find(targets, 'message', 'A>A').lines[0]!.length).toBeGreaterThan(2)
    })

    it.each([
        ['flowchart', FLOWCHART],
        ['state diagram', STATE],
        ['sequence diagram', SEQUENCE],
        ['flowchart with ; statements and chains', 'graph LR; A --> B --> C; A & B --> D\n  C -->|again| A'],
    ])('finds every part of a real %s in its text', (_name, source) => {
        const { targets } = readDiagramTargets(renderMermaidDiagram(source, 'scrivon-light'))
        expect(targets.length).toBeGreaterThan(0)
        for (const target of targets)
            expect(locateDiagramTarget(source, target), `${target.kind} ${target.id || `${target.from}>${target.to}`}`).not.toBeNull()
    })

    it('picks each node and participant of a real picture at its centre', () => {
        for (const source of [FLOWCHART, STATE, SEQUENCE]) {
            const { targets } = readDiagramTargets(renderMermaidDiagram(source, 'scrivon-light'))
            for (const target of targets.filter((t) => t.kind === 'node' || t.kind === 'actor')) {
                expect(targetAtPoint(targets, center(target), 1), target.id).toBe(target)
            }
        }
    })

    it('works each picture out once, and the canvas and palette share it', () => {
        const svg = renderMermaidDiagram(FLOWCHART, 'tokyo-night')
        const parse = vi.spyOn(DOMParser.prototype, 'parseFromString')

        const first = readDiagramTargets(svg)
        const second = readDiagramTargets(svg)

        expect(second).toBe(first)
        expect(parse).toHaveBeenCalledTimes(1)
    })

    it('finds nothing in a picture without parts, or in text that is not SVG', () => {
        expect(readDiagramTargets('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>').targets).toEqual([])
        expect(readDiagramTargets('not svg at all').targets).toEqual([])
    })

    it('places parts by the transforms of the groups around them and the viewBox', () => {
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 100" width="200" height="200">' +
            '<g transform="translate(5,5)"><g class="node" data-id="N"><g transform="scale(2)"><rect x="10" y="20" width="10" height="5"/></g></g></g>' +
            '<g class="actor" data-id="P"><path d="M20 30 l10 0 v10 h-10 Z"/></g>' +
            '</svg>'
        const { targets } = readDiagramTargets(svg)

        // (5 + 2 × 10 − 10) × 2 = 30, (5 + 2 × 20 − 20) × 2 = 50; 20 × 2 wide, 10 × 2 high.
        expect(find(targets, 'node', 'N').box).toEqual({ x: 30, y: 50, width: 40, height: 20 })
        expect(find(targets, 'actor', 'P').box).toEqual({ x: 20, y: 20, width: 20, height: 20 })
    })
})

describe('picking a part', () => {
    const node = (id: string, x: number, y: number, width: number, height: number): DiagramTarget => {
        const box = { x, y, width, height }
        return { kind: 'node', id, from: '', to: '', label: id, occurrence: 0, box, areas: [box], lines: [] }
    }
    const edge = (points: { x: number; y: number }[]): DiagramTarget => {
        const xs = points.map((p) => p.x)
        const ys = points.map((p) => p.y)
        const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
        return { kind: 'edge', id: '', from: 'A', to: 'B', label: '', occurrence: 0, box, areas: [], lines: [points] }
    }

    it('maps a point on screen to the picture through the pan and zoom', () => {
        const canvas = { left: 100, top: 50, width: 400, height: 300 }
        const size = { width: 200, height: 100 }

        // Not moved: the picture's centre is the canvas's centre.
        expect(toDiagramPoint({ x: 300, y: 200 }, canvas, { x: 0, y: 0, scale: 1 }, size)).toEqual({ x: 100, y: 50 })
        // Moved 40 px right and zoomed to 200%: 40 px right of the centre is the picture's centre, and a pixel is half.
        expect(toDiagramPoint({ x: 340, y: 200 }, canvas, { x: 40, y: 0, scale: 2 }, size)).toEqual({ x: 100, y: 50 })
        expect(toDiagramPoint({ x: 360, y: 220 }, canvas, { x: 40, y: 0, scale: 2 }, size)).toEqual({ x: 110, y: 60 })
    })

    it('picks the smallest of the parts under the point, so a node wins over its subgraph', () => {
        const group: DiagramTarget = { ...node('S', 0, 0, 200, 200), kind: 'group' }
        const inner = node('A', 50, 50, 40, 20)
        expect(targetAtPoint([group, inner], { x: 60, y: 60 }, 1)?.id).toBe('A')
        expect(targetAtPoint([inner, group], { x: 60, y: 60 }, 1)?.id).toBe('A')
        expect(targetAtPoint([group, inner], { x: 10, y: 10 }, 1)?.id).toBe('S')
        expect(targetAtPoint([group, inner], { x: 300, y: 10 }, 1)).toBeNull()
    })

    it('picks a thin link within a few screen pixels, at any zoom', () => {
        const link = edge([
            { x: 0, y: 0 },
            { x: 100, y: 0 },
        ])
        const slop = LINE_HIT_SLOP_PX
        expect(targetAtPoint([link], { x: 50, y: slop - 0.5 }, 1)).toBe(link)
        expect(targetAtPoint([link], { x: 50, y: slop + 1 }, 1)).toBeNull()
        // Zoomed out to 50%, a screen pixel is two of the picture's.
        expect(targetAtPoint([link], { x: 50, y: slop * 2 - 1 }, 0.5)).toBe(link)
        // Zoomed in to 400%, it must be four times as close.
        expect(targetAtPoint([link], { x: 50, y: slop / 2 }, 4)).toBeNull()
    })

    it('picks a link over the box it crosses, and the closer of two links', () => {
        const group: DiagramTarget = { ...node('S', 0, 0, 200, 200), kind: 'group' }
        const near = edge([
            { x: 0, y: 100 },
            { x: 200, y: 100 },
        ])
        const far = {
            ...edge([
                { x: 0, y: 103 },
                { x: 200, y: 103 },
            ]),
            occurrence: 1,
        }
        expect(targetAtPoint([group, far, near], { x: 50, y: 101 }, 1)).toBe(near)
        expect(targetAtPoint([group, near, far], { x: 50, y: 102.8 }, 1)).toBe(far)
    })

    it('picks from a point on screen with the canvas box and its view', () => {
        const target = node('A', 0, 0, 10, 10)
        const diagram = { width: 100, height: 100, targets: [target] }
        const canvas = { left: 0, top: 0, width: 100, height: 100 }
        expect(pickDiagramTarget(diagram, { x: 5, y: 5 }, canvas, { x: 0, y: 0, scale: 1 })).toBe(target)
        expect(pickDiagramTarget(diagram, { x: 5, y: 5 }, canvas, { x: 30, y: 30, scale: 1 })).toBeNull()
        expect(pickDiagramTarget({ ...diagram, targets: [] }, { x: 5, y: 5 }, canvas, { x: 0, y: 0, scale: 1 })).toBeNull()
    })

    it('outlines a node with a box and a link along its line', () => {
        expect(targetOutlinePath(node('A', 10, 10, 20, 10))).toBe('M7 7H33V23H7Z')
        expect(
            targetOutlinePath(
                edge([
                    { x: 0, y: 0 },
                    { x: 10, y: 5 },
                ])
            )
        ).toBe('M0 0L10 5')
    })

    it('stays quick on a 500-node flowchart', () => {
        const lines = ['graph TD']
        for (let i = 0; i < 500; i++) lines.push(`  N${i}[Node ${i}] --> N${i + 1}`)
        const diagram = readDiagramTargets(renderMermaidDiagram(lines.join('\n'), 'scrivon-light'))
        expect(diagram.targets.length).toBeGreaterThan(1000)

        const started = performance.now()
        for (let i = 0; i < 100; i++) targetAtPoint(diagram.targets, { x: (i * 37) % diagram.width, y: (i * 53) % diagram.height }, 1)
        // A hover runs once an animation frame: a hundred picks fit easily in a few frames.
        expect(performance.now() - started).toBeLessThan(100)
    })
})
