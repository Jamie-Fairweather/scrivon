/**
 * The templates Scrivon ships, in the order the template picker lists them. Each is filled in by fillTemplate.
 * Plain starters for each diagram type are not here: Ctrl+Space offers those (MERMAID_SNIPPETS), so a diagram
 * template has to add something a starter doesn't.
 */

export type BuiltInTemplate = {
    id: string
    title: string
    /** One line for the picker. */
    description: string
    /** The name the new file starts with. Its extension says whether the template makes a document or a diagram. */
    fileName: string
    source: string
}

const MEETING_NOTES = `# {{title}}

**Date:** {{date}}, {{time}}
**Attendees:**

## Agenda

1.

## Notes

## Decisions

## Action items

- [ ] Who: what, by when
`

const DECISION_RECORD = `# {{title}}

**Status:** Proposed
**Date:** {{date}}
**Deciders:**

## Context

What is the problem, and why does it need a decision now?

## Options considered

1. **Option one.** What it is, and what it costs.
2. **Option two.** What it is, and what it costs.

## Decision

What was decided, and why this option over the others.

## Consequences

What becomes easier or harder because of this decision, and what has to happen next.
`

const PROJECT_BRIEF = `# {{title}}

**Owner:**
**Last updated:** {{date}}

## Summary

One paragraph: what this project is and why it matters.

## Goals

-

## Out of scope

-

## Audience

Who this is for, and what they need from it.

## Timeline

| Milestone | Date |
| --------- | ---- |
|           |      |

## Risks and open questions

-
`

// {{title}} only goes in quoted front matter: file names can hold [ ] ( ) { } # ; %, which a bare label would break on.
const PROCESS_FLOWCHART = `---
title: "{{title}}"
---
flowchart TD
    A([Start]) --> B[First step]
    B --> C[Second step]
    C --> D{Is it done?}
    D -->|Yes| E([End])
    D -->|No| F[Fix what is left]
    F --> C
`

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
    {
        id: 'meeting-notes',
        title: 'Meeting notes',
        description: 'Date, attendees, agenda, notes, decisions and action items',
        fileName: 'meeting-notes.md',
        source: MEETING_NOTES,
    },
    {
        id: 'decision-record',
        title: 'Decision record',
        description: 'The context, the options, what was decided and what follows from it',
        fileName: 'decision-record.md',
        source: DECISION_RECORD,
    },
    {
        id: 'project-brief',
        title: 'Project brief',
        description: 'Summary, goals, scope, audience, timeline and risks',
        fileName: 'project-brief.md',
        source: PROJECT_BRIEF,
    },
    {
        id: 'process-flowchart',
        title: 'Process flowchart',
        description: 'A titled flowchart with a start, steps, a decision and an end',
        fileName: 'process-flow.mmd',
        source: PROCESS_FLOWCHART,
    },
]
