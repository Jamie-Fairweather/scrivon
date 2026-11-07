import { describe, expect, it } from 'vitest'
import { readDiagramAccessibility, withoutAccessibilityLines } from '@/lib/mermaid/accessibility'
import { renderMermaidDiagram, renderMermaidDiagramForExport } from '@/lib/mermaid/render'

const FLOWCHART = 'graph TD\n  accTitle: Sign-in flow\n  accDescr: How a user signs in\n  A[Start] --> B[End]'

describe('diagram accessibility lines (A27)', () => {
    it('reads the title and a one-line description', () => {
        expect(readDiagramAccessibility(FLOWCHART)).toEqual({ title: 'Sign-in flow', description: 'How a user signs in' })
    })

    it('reads a description written over several lines', () => {
        const source = 'graph TD\n  accDescr {\n    How a user\n    signs in\n  }\n  A --> B'
        expect(readDiagramAccessibility(source)).toEqual({ title: null, description: 'How a user signs in' })
        expect(readDiagramAccessibility('graph TD\n  accDescr { On one line }\n  A --> B').description).toBe('On one line')
    })

    it('finds nothing in a diagram without them', () => {
        expect(readDiagramAccessibility('graph TD\n  A --> B')).toEqual({ title: null, description: null })
        expect(readDiagramAccessibility('graph TD\n  %% accTitle: only a comment\n  A --> B').title).toBeNull()
    })

    it('blanks the lines instead of removing them, so error line numbers still match', () => {
        const source = 'graph TD\r\n  accTitle: Sign-in\r\n  accDescr {\r\n    two\r\n    lines\r\n  }\r\n  A --> B'
        const cleaned = withoutAccessibilityLines(source)

        expect(cleaned.split('\n')).toHaveLength(source.split('\n').length)
        expect(cleaned).not.toMatch(/acc|two|lines/)
        expect(cleaned).toContain('A --> B')
    })

    it('leaves a description block alone until it is closed', () => {
        const source = 'graph TD\n  accDescr {\n    still typing\n  A --> B'
        expect(withoutAccessibilityLines(source)).toBe(source)
        expect(readDiagramAccessibility(source).description).toBeNull()
    })

    it('blanks a description block over several lines, or on one line', () => {
        expect(withoutAccessibilityLines('flowchart TD\n  accDescr {\n    multi\n    line }\n  A --> B')).toBe('flowchart TD\n\n\n\n  A --> B')
        expect(withoutAccessibilityLines('stateDiagram-v2\n  accTitle: States\n  accDescr { one line }\n  [*] --> Idle')).toBe(
            'stateDiagram-v2\n\n\n  [*] --> Idle'
        )
    })

    it('keeps diagram text written after the closing brace', () => {
        const source = 'graph TD\n  accDescr { note } A --> B'
        expect(withoutAccessibilityLines(source)).toBe('graph TD\n A --> B')
        expect(readDiagramAccessibility(source).description).toBe('note')
        expect(withoutAccessibilityLines('graph TD\n  accDescr {\n    two\n  lines } B --> C\n  A --> B')).toBe('graph TD\n\n\n B --> C\n  A --> B')
    })

    it('matches the keywords only as Mermaid writes them, and leaves comments and labels alone', () => {
        const source = '%%{init: {"theme": "dark"}}%%\nstateDiagram-v2\n  %% accTitle: in a comment\n  ACCTITLE : States\n  A[accTitle] --> B\n'
        expect(withoutAccessibilityLines(source)).toBe(source)
        expect(readDiagramAccessibility(source)).toEqual({ title: null, description: null })
    })

    it('returns the same text when there is nothing to blank', () => {
        const source = 'graph TD\n  account --> access'
        expect(withoutAccessibilityLines(source)).toBe(source)
    })

    it('keeps the lines out of the drawing, in the preview and in exports', () => {
        for (const svg of [renderMermaidDiagram(FLOWCHART, 'scrivon-light'), renderMermaidDiagramForExport(FLOWCHART, 'scrivon-light')]) {
            expect(svg).not.toContain('accTitle')
            expect(svg).not.toContain('Sign-in flow')
            expect(svg).toContain('Start')
        }
    })
})
