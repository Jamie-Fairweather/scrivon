import { describe, expect, it } from 'vitest'
import {
    completeDiagramColors,
    DIAGRAM_FONT_FAMILY,
    MERMAID_DEFAULT_SECURE_KEYS,
    officialMermaidConfig,
    officialThemeVariables,
} from '@/lib/mermaid/official-theme'
import { APP_THEME_IDS, getDiagramColors, isLightTheme } from '@/lib/theme/catalog'
import { contrastRatio, hexColorMix } from '@/lib/theme/color-mix'

const HEX = /^#[\da-f]{6}$/i

describe('completeDiagramColors', () => {
    it.each(APP_THEME_IDS)('fills in every colour %s leaves out, and keeps the ones it sets', (themeId) => {
        const given = getDiagramColors(themeId)
        const colors = completeDiagramColors(themeId)
        for (const key of ['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'] as const) expect(colors[key]).toMatch(HEX)
        for (const [key, value] of Object.entries(given)) expect(colors[key as keyof typeof colors]).toBe(value)
    })

    it("mixes the gaps from the background and text as beautiful-mermaid's color-mix() does", () => {
        const { bg, fg } = getDiagramColors('scrivon-light')
        expect(completeDiagramColors('scrivon-light')).toEqual({
            bg,
            fg,
            line: hexColorMix(fg, bg, 50),
            accent: hexColorMix(fg, bg, 85),
            muted: hexColorMix(fg, bg, 40),
            surface: hexColorMix(fg, bg, 3),
            border: hexColorMix(fg, bg, 20),
        })
    })
})

describe('officialThemeVariables', () => {
    it.each(APP_THEME_IDS)('gives only hex colours for %s, with no gaps', (themeId) => {
        const vars = officialThemeVariables(themeId)
        for (const [name, value] of Object.entries(vars)) expect([name, value]).toEqual([name, expect.stringMatching(HEX)])
        for (let i = 1; i <= 12; i++) expect(vars[`pie${i}`]).toMatch(HEX)
        for (let i = 0; i < 12; i++) {
            for (const name of ['cScale', 'cScalePeer', 'cScaleInv', 'cScaleLabel']) expect(vars[`${name}${i}`]).toMatch(HEX)
        }
        for (let i = 0; i < 8; i++) {
            for (const name of ['git', 'gitInv', 'gitBranchLabel']) expect(vars[`${name}${i}`]).toMatch(HEX)
        }
        for (const name of ['background', 'primaryColor', 'primaryTextColor', 'lineColor', 'textColor', 'altSectionBkgColor', 'pieStrokeColor']) {
            expect(vars[name]).toMatch(HEX)
        }
    })

    it.each(APP_THEME_IDS)("draws %s's diagrams on its own background, in its own text colour", (themeId) => {
        const { bg, fg } = getDiagramColors(themeId)
        const vars = officialThemeVariables(themeId)
        expect(vars.background).toBe(bg)
        expect(vars.primaryTextColor).toBe(fg)
        expect(vars.textColor).toBe(fg)
        // A Gantt chart's alternate sections are the background, not Mermaid's white.
        expect(vars.altSectionBkgColor).toBe(bg)
    })

    it.each(APP_THEME_IDS)('gives %s pie slices and git branches that differ from their neighbours, and readable labels', (themeId) => {
        const vars = officialThemeVariables(themeId)
        const slices = Array.from({ length: 12 }, (_, i) => vars[`pie${i + 1}`])
        expect(new Set(slices).size).toBe(12)
        const branches = Array.from({ length: 8 }, (_, i) => vars[`git${i}`])
        expect(new Set(branches).size).toBe(8)
        for (let i = 0; i < 12; i++) expect(contrastRatio(vars[`cScaleLabel${i}`]!, vars[`cScale${i}`]!)).toBeGreaterThanOrEqual(4.5)
        for (let i = 0; i < 8; i++) expect(contrastRatio(vars[`gitBranchLabel${i}`]!, vars[`git${i}`]!)).toBeGreaterThanOrEqual(4.5)
    })
})

describe('officialMermaidConfig', () => {
    it.each(APP_THEME_IDS)('sets strict, local settings for %s that a diagram cannot change', (themeId) => {
        const config = officialMermaidConfig(themeId)
        expect(config).toEqual({
            startOnLoad: false,
            securityLevel: 'strict',
            suppressErrorRendering: true,
            theme: 'base',
            darkMode: !isLightTheme(themeId),
            fontFamily: DIAGRAM_FONT_FAMILY,
            htmlLabels: false,
            themeVariables: { ...officialThemeVariables(themeId), darkMode: !isLightTheme(themeId), fontFamily: DIAGRAM_FONT_FAMILY },
            secure: expect.any(Array),
        })
        // Mermaid's own list, so setting it doesn't let a diagram turn security off, and Scrivon's theme on top.
        expect(config.secure).toEqual([...MERMAID_DEFAULT_SECURE_KEYS, 'theme', 'themeVariables', 'themeCSS', 'fontFamily', 'darkMode', 'htmlLabels'])
        expect(config.secure).toEqual(
            expect.arrayContaining(['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges'])
        )
    })

    it('uses the system font stack, never a web font', () => {
        expect(DIAGRAM_FONT_FAMILY).not.toMatch(/url\(|https?:/)
        expect(DIAGRAM_FONT_FAMILY).toContain('system-ui')
    })
})
