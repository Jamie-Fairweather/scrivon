import { describe, expect, it } from 'vitest'
import { fillTemplate, formatTemplateDate, formatTemplateTime } from '@/lib/templates/fill-template'

// 7 March 2026, 09:05 local time: one-digit month, day, hour and minute, to check the padding.
const NOW = new Date(2026, 2, 7, 9, 5, 42)

const fill = (source: string, kind: 'markdown' | 'mermaid' = 'markdown', title = 'Weekly review') => fillTemplate(source, { title, now: NOW, kind })

describe('fillTemplate', () => {
    it('fills in the title, the date and the time', () => {
        expect(fill('# {{title}}\n\n{{date}} at {{time}}\n')).toBe('# Weekly review\n\n2026-03-07 at 09:05\n')
    })

    it('fills in each placeholder every time it appears', () => {
        expect(fill('{{title}} / {{title}} / {{date}}{{date}}')).toBe('Weekly review / Weekly review / 2026-03-072026-03-07')
    })

    it('allows spaces and tabs inside the braces', () => {
        expect(fill('{{ title }}|{{date }}|{{\ttime\t}}|{{  title}}')).toBe('Weekly review|2026-03-07|09:05|Weekly review')
    })

    it('leaves unknown placeholders and other braces as typed', () => {
        expect(fill('{{author}} {{ cursor }} {{}} {title} {{title}')).toBe('{{author}} {{ cursor }} {{}} {title} {{title}')
        expect(fill('{{toString}} {{constructor}}')).toBe('{{toString}} {{constructor}}')
    })

    it('matches placeholder names exactly', () => {
        expect(fill('{{Title}} {{DATE}}')).toBe('{{Title}} {{DATE}}')
    })

    it('puts in the title as given, whatever characters it has', () => {
        const title = 'Q3 [draft] #2 (v1); 50% $& $1'
        expect(fill('title: "{{title}}"', 'mermaid', title)).toBe(`title: "${title}"`)
    })

    it('leaves hexagon nodes in a diagram alone', () => {
        const source = ['flowchart TD', '    A{{Decide}} --> node_1{{title}}', '    x-{{date}}', '    9{{time}}', '    B["{{title}}"]'].join('\n')
        expect(fill(source, 'mermaid')).toBe(
            ['flowchart TD', '    A{{Decide}} --> node_1{{title}}', '    x-{{date}}', '    9{{time}}', '    B["Weekly review"]'].join('\n')
        )
    })

    it('fills a placeholder at the very start of a diagram, or after a space or punctuation', () => {
        expect(fill('{{title}}\n A --> {{date}} ({{time}})', 'mermaid')).toBe('Weekly review\n A --> 2026-03-07 (09:05)')
    })

    it('fills placeholders straight after a word in a document, where there are no hexagons', () => {
        expect(fill('Notes{{date}} v{{time}}')).toBe('Notes2026-03-07 v09:05')
    })
})

describe('template dates', () => {
    it('writes the date as YYYY-MM-DD and the time as HH:mm, both local', () => {
        expect(formatTemplateDate(new Date(2025, 11, 31, 23, 59))).toBe('2025-12-31')
        expect(formatTemplateTime(new Date(2025, 11, 31, 23, 59))).toBe('23:59')
        expect(formatTemplateTime(new Date(2025, 0, 1, 0, 0))).toBe('00:00')
    })
})
