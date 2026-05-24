export type DiagramColors = {
    bg: string
    fg: string
    line?: string
    accent?: string
    muted?: string
    surface?: string
    border?: string
}

export type AppThemeDefinition = {
    label: string
    kind: 'light' | 'dark'
    colors: DiagramColors
}
