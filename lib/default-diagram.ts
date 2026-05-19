export const DEFAULT_DIAGRAM = `graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Action]
  B -->|No| D[End]
  C --> D
`
