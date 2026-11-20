import type { MermaidConfig } from 'mermaid'
import { getDiagramColors, isLightTheme, type AppThemeId } from '@/lib/theme/catalog'
import { contrastRatio, ensureContrast, hexColorMix, parseHexColor, rotateHue } from '@/lib/theme/color-mix'
import type { DiagramColors } from '@/lib/theme/types'

/**
 * The official `mermaid` package's settings for the diagram types beautiful-mermaid can't draw (see
 * render-official.ts), so they take the diagram theme's colours like the others do.
 */

/** Every diagram colour, with the ones a theme leaves out mixed from its background and text. */
export type CompleteDiagramColors = Required<DiagramColors>

/**
 * How much of the text colour each missing colour gets, mixed into the background. The same mixes beautiful-mermaid
 * uses with `color-mix()` (its MIX table), so a theme without them looks the same in both engines.
 */
const FALLBACK_MIX = { line: 50, accent: 85, muted: 40, surface: 3, border: 20 } as const

/** The colour beautiful-mermaid's XY charts fall back to for a theme with no accent. */
const CHART_ACCENT_FALLBACK = '#3b82f6'

/** A red for critical tasks and today's line in a Gantt chart. No theme has one. */
const CRITICAL_RED = '#e5484d'

/** The font beautiful-mermaid's diagrams use, from the system: nothing is fetched. */
export const DIAGRAM_FONT_FAMILY = "Inter, 'Segoe UI', system-ui, sans-serif"

/** How many colours Mermaid cycles through for pie slices, sections (cScale) and git branches. */
const PIE_COLORS = 12
const SCALE_COLORS = 12
const GIT_COLORS = 8

/**
 * Hue turns for each colour in a series, so neighbouring slices and branches never look alike: 150° apart, which
 * visits all twelve multiples of 30° before repeating.
 */
const SERIES_TURNS = Array.from({ length: 12 }, (_, i) => (i * 150) % 360)

/** The theme's diagram colours, with `line`, `accent`, `muted`, `surface` and `border` filled in where it has none. */
export function completeDiagramColors(themeId: AppThemeId): CompleteDiagramColors {
    const { bg, fg, ...given } = getDiagramColors(themeId)
    const mix = (percent: number) => hexColorMix(fg, bg, percent)
    return {
        bg,
        fg,
        line: given.line ?? mix(FALLBACK_MIX.line),
        accent: given.accent ?? mix(FALLBACK_MIX.accent),
        muted: given.muted ?? mix(FALLBACK_MIX.muted),
        surface: given.surface ?? mix(FALLBACK_MIX.surface),
        border: given.border ?? mix(FALLBACK_MIX.border),
    }
}

/** A grey (or a near-grey) can't be turned round the colour wheel into a series. */
function hasHue(hex: string): boolean {
    const rgb = parseHexColor(hex)
    if (!rgb) return false
    return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) >= 24
}

/** WCAG AA for normal text: slice, section and branch labels are small. */
const LABEL_CONTRAST = 4.5

/**
 * Of the theme's text and background, the one that reads better on `fill`, taken on towards black or white when
 * even that isn't clear enough (a mid-tone branch colour, or a low-contrast theme like Solarized).
 */
function textOn(fill: string, colors: CompleteDiagramColors): string {
    const better = contrastRatio(colors.fg, fill) >= contrastRatio(colors.bg, fill) ? colors.fg : colors.bg
    return ensureContrast(better, better, [fill], LABEL_CONTRAST)
}

/**
 * Mermaid's `themeVariables` for the `base` theme, built from the diagram theme: plain hex colours only, every one
 * Mermaid would otherwise work out itself (or leave as its own light defaults, like a white Gantt section in a dark
 * theme). Slices, sections and branches take turns round the colour wheel from the theme's accent, or from
 * beautiful-mermaid's chart blue for a theme whose accent is grey.
 */
export function officialThemeVariables(themeId: AppThemeId): Record<string, string> {
    const colors = completeDiagramColors(themeId)
    const { bg, fg, line, accent, muted, surface, border } = colors
    const tint = (color: string, percent: number) => hexColorMix(color, bg, percent)
    const seriesBase = hasHue(accent) ? accent : CHART_ACCENT_FALLBACK
    const series = (i: number) => rotateHue(seriesBase, SERIES_TURNS[i % SERIES_TURNS.length]!)
    const soft = tint(fg, 6)
    const red = tint(CRITICAL_RED, isLightTheme(themeId) ? 100 : 85)

    const vars: Record<string, string> = {
        background: bg,
        primaryColor: surface,
        primaryTextColor: fg,
        primaryBorderColor: border,
        secondaryColor: soft,
        secondaryTextColor: fg,
        secondaryBorderColor: border,
        tertiaryColor: tint(fg, 4),
        tertiaryTextColor: fg,
        tertiaryBorderColor: border,
        mainBkg: surface,
        nodeBkg: surface,
        nodeBorder: border,
        nodeTextColor: fg,
        textColor: fg,
        titleColor: fg,
        lineColor: line,
        arrowheadColor: accent,
        defaultLinkColor: line,
        border1: border,
        border2: border,
        clusterBkg: soft,
        clusterBorder: border,
        edgeLabelBackground: bg,
        labelBackground: bg,
        labelTextColor: fg,
        labelBoxBkgColor: surface,
        labelBoxBorderColor: border,
        loopTextColor: fg,
        noteBkgColor: tint(accent, 12),
        noteTextColor: fg,
        noteBorderColor: tint(accent, 45),
        errorBkgColor: soft,
        errorTextColor: fg,
        // C4
        personBkg: surface,
        personBorder: border,
        // Gantt
        sectionBkgColor: tint(accent, 10),
        altSectionBkgColor: bg,
        sectionBkgColor2: tint(accent, 5),
        excludeBkgColor: soft,
        gridColor: tint(fg, 15),
        taskBkgColor: tint(accent, 30),
        taskBorderColor: accent,
        taskTextColor: fg,
        taskTextOutsideColor: fg,
        taskTextLightColor: fg,
        taskTextDarkColor: fg,
        taskTextClickableColor: accent,
        activeTaskBkgColor: tint(accent, 55),
        activeTaskBorderColor: accent,
        doneTaskBkgColor: tint(fg, 15),
        doneTaskBorderColor: muted,
        critBkgColor: tint(red, 35),
        critBorderColor: red,
        todayLineColor: red,
        vertLineColor: accent,
        // Pie charts
        pieTitleTextColor: fg,
        pieSectionTextColor: fg,
        pieLegendTextColor: fg,
        pieStrokeColor: bg,
        pieOuterStrokeColor: border,
        // Quadrant charts
        quadrant1Fill: tint(accent, 16),
        quadrant2Fill: tint(accent, 11),
        quadrant3Fill: tint(accent, 6),
        quadrant4Fill: tint(accent, 11),
        quadrant1TextFill: fg,
        quadrant2TextFill: fg,
        quadrant3TextFill: fg,
        quadrant4TextFill: fg,
        quadrantPointFill: accent,
        quadrantPointTextFill: fg,
        quadrantXAxisTextFill: fg,
        quadrantYAxisTextFill: fg,
        quadrantTitleFill: fg,
        quadrantInternalBorderStrokeFill: border,
        quadrantExternalBorderStrokeFill: border,
        // Requirement diagrams
        requirementBackground: surface,
        requirementBorderColor: border,
        requirementTextColor: fg,
        relationColor: line,
        relationLabelBackground: bg,
        relationLabelColor: fg,
        // Git graphs
        tagLabelColor: fg,
        tagLabelBackground: surface,
        tagLabelBorder: border,
        commitLabelColor: fg,
        commitLabelBackground: surface,
        // Architecture diagrams
        archEdgeColor: line,
        archEdgeArrowColor: line,
        archGroupBorderColor: border,
        // User journeys
        faceColor: tint(accent, 25),
        actorBkg: surface,
        actorBorder: border,
        actorTextColor: fg,
        actorLineColor: line,
        // Mind maps, timelines, kanban boards, treemaps and radar charts colour each section from cScale.
        scaleLabelColor: fg,
    }

    for (let i = 0; i < PIE_COLORS; i++) vars[`pie${i + 1}`] = tint(series(i), 80)
    for (let i = 0; i < SCALE_COLORS; i++) {
        const fill = tint(series(i), 45)
        vars[`cScale${i}`] = fill
        vars[`cScalePeer${i}`] = tint(series(i), 75)
        vars[`cScaleInv${i}`] = textOn(fill, colors)
        vars[`cScaleLabel${i}`] = textOn(fill, colors)
    }
    for (let i = 0; i < 5; i++) {
        vars[`surface${i}`] = tint(fg, 4 + i * 3)
        vars[`surfacePeer${i}`] = tint(fg, 7 + i * 3)
    }
    for (let i = 0; i < 8; i++) vars[`fillType${i}`] = tint(series(i), 25)
    for (let i = 0; i < GIT_COLORS; i++) {
        const branch = series(i)
        vars[`git${i}`] = branch
        vars[`gitInv${i}`] = bg
        vars[`gitBranchLabel${i}`] = textOn(branch, colors)
    }
    return vars
}

/** The settings Mermaid itself keeps a diagram from changing (its `secure` default). */
export const MERMAID_DEFAULT_SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges'] as const

/**
 * And the ones Scrivon keeps too, so a diagram's `%%{init}%%` or front matter `config` can't swap the diagram theme
 * for its own, or bring in CSS. A `url()` in `themeCSS` would otherwise be fetched: the CSP lets images load from
 * the web, for Markdown pictures.
 */
export const SCRIVON_SECURE_KEYS = ['theme', 'themeVariables', 'themeCSS', 'fontFamily', 'darkMode', 'htmlLabels'] as const

/**
 * What one render passes to `mermaid.initialize`: strict security, no drawing on page load, errors thrown rather
 * than drawn as a bomb, the `base` theme coloured from the diagram theme, the system font stack, and SVG text rather
 * than HTML labels wherever a type can do without them (HTML labels can't be drawn into a PNG).
 */
export function officialMermaidConfig(themeId: AppThemeId): MermaidConfig {
    const darkMode = !isLightTheme(themeId)
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        darkMode,
        fontFamily: DIAGRAM_FONT_FAMILY,
        htmlLabels: false,
        themeVariables: { ...officialThemeVariables(themeId), darkMode, fontFamily: DIAGRAM_FONT_FAMILY },
        // Without its defaults, setting this would let a diagram turn security off.
        secure: [...MERMAID_DEFAULT_SECURE_KEYS, ...SCRIVON_SECURE_KEYS],
    }
}
